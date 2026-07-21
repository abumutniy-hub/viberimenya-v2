import { extname, resolve, sep } from "node:path";

export function telegramPhotoContentType(filename: string) {
  const extension = extname(filename).toLowerCase();

  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  return "image/jpeg";
}

export function resolveTelegramLocalUploadPath(
  photoUrl: string,
  siteUrl: string,
  uploadsDir: string,
) {
  let parsed: URL;

  try {
    parsed = new URL(photoUrl, siteUrl);
  } catch {
    return null;
  }

  if (!parsed.pathname.startsWith("/uploads/")) {
    return null;
  }

  let relativePath: string;

  try {
    relativePath = decodeURIComponent(
      parsed.pathname.slice("/uploads/".length),
    );
  } catch {
    return null;
  }

  if (
    !relativePath
    || relativePath.includes("..")
    || relativePath.includes("\\")
  ) {
    return null;
  }

  const uploadRoot = resolve(uploadsDir);
  const filePath = resolve(uploadRoot, relativePath);

  if (
    filePath !== uploadRoot
    && !filePath.startsWith(`${uploadRoot}${sep}`)
  ) {
    return null;
  }

  return filePath;
}
