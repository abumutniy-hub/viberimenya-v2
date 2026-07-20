const VERSION = 6;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const EC_CODEWORDS_PER_BLOCK = 16;
const BLOCK_COUNT = 4;
const ALIGNMENT_PATTERN_POSITIONS = [6, 34] as const;

function utf8Bytes(value: string) {
  return Array.from(new TextEncoder().encode(value));
}

class BitBuffer {
  readonly bytes: number[] = [];
  length = 0;

  put(value: number, length: number) {
    for (let index = length - 1; index >= 0; index -= 1) {
      this.putBit(((value >>> index) & 1) === 1);
    }
  }

  putBit(bit: boolean) {
    const byteIndex = Math.floor(this.length / 8);

    if (this.bytes.length <= byteIndex) {
      this.bytes.push(0);
    }

    if (bit) {
      this.bytes[byteIndex] = (
        this.bytes[byteIndex] ?? 0
      ) | (0x80 >>> (this.length % 8));
    }

    this.length += 1;
  }
}

const EXP_TABLE = new Array<number>(512).fill(0);
const LOG_TABLE = new Array<number>(256).fill(0);

{
  let value = 1;

  for (let index = 0; index < 255; index += 1) {
    EXP_TABLE[index] = value;
    LOG_TABLE[value] = index;
    value <<= 1;

    if (value & 0x100) {
      value ^= 0x11d;
    }
  }

  for (let index = 255; index < EXP_TABLE.length; index += 1) {
    EXP_TABLE[index] = EXP_TABLE[index - 255]!;
  }
}

function gfMultiply(left: number, right: number) {
  if (left === 0 || right === 0) return 0;

  return EXP_TABLE[LOG_TABLE[left]! + LOG_TABLE[right]!]!;
}

function polynomialMultiply(left: number[], right: number[]) {
  const result = new Array<number>(
    left.length + right.length - 1,
  ).fill(0);

  for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
    for (
      let rightIndex = 0;
      rightIndex < right.length;
      rightIndex += 1
    ) {
      const resultIndex = leftIndex + rightIndex;
      result[resultIndex] = (
        result[resultIndex] ?? 0
      ) ^ gfMultiply(
        left[leftIndex]!,
        right[rightIndex]!,
      );
    }
  }

  return result;
}

function generatorPolynomial(degree: number) {
  let polynomial = [1];

  for (let index = 0; index < degree; index += 1) {
    polynomial = polynomialMultiply(
      polynomial,
      [1, EXP_TABLE[index]!],
    );
  }

  return polynomial;
}

function reedSolomonRemainder(data: number[], degree: number) {
  const generator = generatorPolynomial(degree);
  const remainder = new Array<number>(degree).fill(0);

  for (const byte of data) {
    const factor = byte ^ remainder[0]!;
    remainder.shift();
    remainder.push(0);

    for (let index = 0; index < degree; index += 1) {
      remainder[index] = (
        remainder[index] ?? 0
      ) ^ gfMultiply(
        generator[index + 1]!,
        factor,
      );
    }
  }

  return remainder;
}

function createCodewords(text: string) {
  const data = utf8Bytes(text);

  if (data.length > 106) {
    throw new Error(
      "Telegram deep-link is too long for the local QR encoder",
    );
  }

  const buffer = new BitBuffer();
  buffer.put(0b0100, 4);
  buffer.put(data.length, 8);

  for (const byte of data) {
    buffer.put(byte, 8);
  }

  const totalDataBits = DATA_CODEWORDS * 8;
  buffer.put(0, Math.min(4, totalDataBits - buffer.length));

  while (buffer.length % 8 !== 0) {
    buffer.putBit(false);
  }

  let padToggle = false;

  while (buffer.bytes.length < DATA_CODEWORDS) {
    buffer.bytes.push(padToggle ? 0x11 : 0xec);
    padToggle = !padToggle;
  }

  const blocks: number[][] = [];

  for (let blockIndex = 0; blockIndex < BLOCK_COUNT; blockIndex += 1) {
    blocks.push(
      buffer.bytes.slice(blockIndex * 27, blockIndex * 27 + 27),
    );
  }

  const errorBlocks = blocks.map((block) =>
    reedSolomonRemainder(block, EC_CODEWORDS_PER_BLOCK),
  );
  const result: number[] = [];

  for (let index = 0; index < 27; index += 1) {
    for (const block of blocks) {
      result.push(block[index]!);
    }
  }

  for (
    let index = 0;
    index < EC_CODEWORDS_PER_BLOCK;
    index += 1
  ) {
    for (const block of errorBlocks) {
      result.push(block[index]!);
    }
  }

  return result;
}

type Matrix = Array<Array<boolean | null>>;

function emptyMatrix(): Matrix {
  return Array.from(
    { length: SIZE },
    () => new Array<boolean | null>(SIZE).fill(null),
  );
}

function setupFinder(matrix: Matrix, row: number, column: number) {
  for (let rowOffset = -1; rowOffset <= 7; rowOffset += 1) {
    const currentRow = row + rowOffset;

    if (currentRow < 0 || currentRow >= SIZE) continue;

    for (
      let columnOffset = -1;
      columnOffset <= 7;
      columnOffset += 1
    ) {
      const currentColumn = column + columnOffset;

      if (currentColumn < 0 || currentColumn >= SIZE) continue;

      matrix[currentRow]![currentColumn] = (
        (rowOffset >= 0 && rowOffset <= 6
          && (columnOffset === 0 || columnOffset === 6))
        || (columnOffset >= 0 && columnOffset <= 6
          && (rowOffset === 0 || rowOffset === 6))
        || (rowOffset >= 2 && rowOffset <= 4
          && columnOffset >= 2 && columnOffset <= 4)
      );
    }
  }
}

function setupAlignment(matrix: Matrix) {
  for (const row of ALIGNMENT_PATTERN_POSITIONS) {
    for (const column of ALIGNMENT_PATTERN_POSITIONS) {
      if (matrix[row]![column] !== null) continue;

      for (let rowOffset = -2; rowOffset <= 2; rowOffset += 1) {
        for (
          let columnOffset = -2;
          columnOffset <= 2;
          columnOffset += 1
        ) {
          matrix[row + rowOffset]![column + columnOffset] = (
            Math.max(
              Math.abs(rowOffset),
              Math.abs(columnOffset),
            ) !== 1
          );
        }
      }
    }
  }
}

function setupTiming(matrix: Matrix) {
  for (let index = 8; index < SIZE - 8; index += 1) {
    if (matrix[index]![6] === null) {
      matrix[index]![6] = index % 2 === 0;
    }

    if (matrix[6]![index] === null) {
      matrix[6]![index] = index % 2 === 0;
    }
  }
}

function bchDigit(value: number) {
  let digits = 0;

  while (value !== 0) {
    digits += 1;
    value >>>= 1;
  }

  return digits;
}

function formatBits(maskPattern: number) {
  const data = maskPattern;
  let bits = data << 10;
  const generator = 0x537;

  while (bchDigit(bits) - bchDigit(generator) >= 0) {
    bits ^= generator << (
      bchDigit(bits) - bchDigit(generator)
    );
  }

  return ((data << 10) | bits) ^ 0x5412;
}

function setupFormatInfo(
  matrix: Matrix,
  maskPattern: number,
  test: boolean,
) {
  const bits = formatBits(maskPattern);

  for (let index = 0; index < 15; index += 1) {
    const dark = !test && ((bits >>> index) & 1) === 1;

    if (index < 6) {
      matrix[index]![8] = dark;
    } else if (index < 8) {
      matrix[index + 1]![8] = dark;
    } else {
      matrix[SIZE - 15 + index]![8] = dark;
    }

    if (index < 8) {
      matrix[8]![SIZE - index - 1] = dark;
    } else if (index < 9) {
      matrix[8]![15 - index] = dark;
    } else {
      matrix[8]![15 - index - 1] = dark;
    }
  }

  matrix[SIZE - 8]![8] = !test;
}

function maskCondition(
  pattern: number,
  row: number,
  column: number,
) {
  if (pattern === 0) return (row + column) % 2 === 0;
  if (pattern === 1) return row % 2 === 0;
  if (pattern === 2) return column % 3 === 0;
  if (pattern === 3) return (row + column) % 3 === 0;
  if (pattern === 4) {
    return (
      Math.floor(row / 2) + Math.floor(column / 3)
    ) % 2 === 0;
  }
  if (pattern === 5) {
    return (
      (row * column) % 2 + (row * column) % 3
    ) === 0;
  }
  if (pattern === 6) {
    return (
      ((row * column) % 2 + (row * column) % 3) % 2
    ) === 0;
  }

  return (
    ((row * column) % 3 + (row + column) % 2) % 2
  ) === 0;
}

function mapData(
  matrix: Matrix,
  codewords: number[],
  maskPattern: number,
) {
  let upward = true;
  let row = SIZE - 1;
  let byteIndex = 0;
  let bitIndex = 7;

  for (let column = SIZE - 1; column > 0; column -= 2) {
    if (column === 6) {
      column -= 1;
    }

    while (true) {
      for (let offset = 0; offset < 2; offset += 1) {
        const currentColumn = column - offset;

        if (matrix[row]![currentColumn] !== null) continue;

        let dark = false;

        if (byteIndex < codewords.length) {
          dark = (
            (codewords[byteIndex]! >>> bitIndex) & 1
          ) === 1;
        }

        if (maskCondition(maskPattern, row, currentColumn)) {
          dark = !dark;
        }

        matrix[row]![currentColumn] = dark;
        bitIndex -= 1;

        if (bitIndex < 0) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }

      row += upward ? -1 : 1;

      if (row < 0 || row >= SIZE) {
        row += upward ? 1 : -1;
        upward = !upward;
        break;
      }
    }
  }
}

function penalty(matrix: Matrix) {
  let score = 0;

  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      const dark = matrix[row]![column] === true;
      let same = 0;

      for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
        for (
          let columnOffset = -1;
          columnOffset <= 1;
          columnOffset += 1
        ) {
          if (rowOffset === 0 && columnOffset === 0) continue;

          const otherRow = row + rowOffset;
          const otherColumn = column + columnOffset;

          if (
            otherRow < 0
            || otherRow >= SIZE
            || otherColumn < 0
            || otherColumn >= SIZE
          ) {
            continue;
          }

          if (
            (matrix[otherRow]![otherColumn] === true) === dark
          ) {
            same += 1;
          }
        }
      }

      if (same > 5) {
        score += 3 + same - 5;
      }
    }
  }

  for (let row = 0; row < SIZE - 1; row += 1) {
    for (let column = 0; column < SIZE - 1; column += 1) {
      const count = [
        matrix[row]![column],
        matrix[row + 1]![column],
        matrix[row]![column + 1],
        matrix[row + 1]![column + 1],
      ].filter(Boolean).length;

      if (count === 0 || count === 4) {
        score += 3;
      }
    }
  }

  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE - 6; column += 1) {
      if (
        matrix[row]![column]
        && !matrix[row]![column + 1]
        && matrix[row]![column + 2]
        && matrix[row]![column + 3]
        && matrix[row]![column + 4]
        && !matrix[row]![column + 5]
        && matrix[row]![column + 6]
      ) {
        score += 40;
      }
    }
  }

  for (let column = 0; column < SIZE; column += 1) {
    for (let row = 0; row < SIZE - 6; row += 1) {
      if (
        matrix[row]![column]
        && !matrix[row + 1]![column]
        && matrix[row + 2]![column]
        && matrix[row + 3]![column]
        && matrix[row + 4]![column]
        && !matrix[row + 5]![column]
        && matrix[row + 6]![column]
      ) {
        score += 40;
      }
    }
  }

  const darkCount = matrix
    .flat()
    .filter((cell) => cell === true)
    .length;
  const ratio = Math.abs(
    100 * darkCount / (SIZE * SIZE) - 50,
  );

  score += Math.floor(ratio / 5) * 10;

  return score;
}

function createMatrix(text: string) {
  const codewords = createCodewords(text);
  let bestMatrix: Matrix | null = null;
  let bestPenalty = Number.POSITIVE_INFINITY;

  for (let maskPattern = 0; maskPattern < 8; maskPattern += 1) {
    const matrix = emptyMatrix();
    setupFinder(matrix, 0, 0);
    setupFinder(matrix, SIZE - 7, 0);
    setupFinder(matrix, 0, SIZE - 7);
    setupAlignment(matrix);
    setupTiming(matrix);
    setupFormatInfo(matrix, maskPattern, true);
    mapData(matrix, codewords, maskPattern);
    setupFormatInfo(matrix, maskPattern, false);

    const currentPenalty = penalty(matrix);

    if (currentPenalty < bestPenalty) {
      bestPenalty = currentPenalty;
      bestMatrix = matrix;
    }
  }

  if (!bestMatrix) {
    throw new Error("QR matrix was not created");
  }

  return bestMatrix;
}

export function renderPairingQrSvg(text: string) {
  const matrix = createMatrix(text);
  const quietZone = 4;
  const viewSize = SIZE + quietZone * 2;
  const paths: string[] = [];

  for (let row = 0; row < SIZE; row += 1) {
    for (let column = 0; column < SIZE; column += 1) {
      if (matrix[row]![column] === true) {
        paths.push(
          `M${column + quietZone} ${row + quietZone}h1v1h-1z`,
        );
      }
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg"`,
    ` viewBox="0 0 ${viewSize} ${viewSize}"`,
    ` shape-rendering="crispEdges"`,
    ` aria-label="QR-код для входа через Telegram">`,
    `<rect width="100%" height="100%" fill="#fff"/>`,
    `<path d="${paths.join("")}" fill="#111"/>`,
    `</svg>`,
  ].join("");
}

export function pairingQrDataUrl(text: string) {
  return `data:image/svg+xml;base64,${Buffer
    .from(renderPairingQrSvg(text), "utf8")
    .toString("base64")}`;
}
