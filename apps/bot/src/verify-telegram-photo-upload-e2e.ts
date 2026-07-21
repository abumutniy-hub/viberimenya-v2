import {
  resolveTelegramLocalUploadPath,
  telegramPhotoContentType,
} from "./telegram-photo-upload";

function assertCondition(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

function pass(message: string) {
  console.log(`✓ ${message}`);
}

const uploadsDir = "/var/www/viberimenya-v2/storage/uploads";
const siteUrl = "https://viberimenya.ru";

assertCondition(
  resolveTelegramLocalUploadPath(
    "https://viberimenya.ru/uploads/bouquets/order/photo.jpg",
    siteUrl,
    uploadsDir,
  ) === "/var/www/viberimenya-v2/storage/uploads/bouquets/order/photo.jpg",
  "Публичная ссылка не сопоставилась с локальным файлом",
);
assertCondition(
  resolveTelegramLocalUploadPath(
    "/uploads/bouquets/order/photo.webp?version=2",
    siteUrl,
    uploadsDir,
  ) === "/var/www/viberimenya-v2/storage/uploads/bouquets/order/photo.webp",
  "Относительная ссылка не сопоставилась с локальным файлом",
);
pass("фото из /uploads сопоставляется с локальным хранилищем");

assertCondition(
  resolveTelegramLocalUploadPath(
    "/uploads/../.env",
    siteUrl,
    uploadsDir,
  ) === null,
  "Path traversal не заблокирован",
);
assertCondition(
  resolveTelegramLocalUploadPath(
    "https://example.org/image.jpg",
    siteUrl,
    uploadsDir,
  ) === null,
  "Внешняя ссылка ошибочно принята как локальная",
);
assertCondition(
  resolveTelegramLocalUploadPath(
    "/not-uploads/photo.jpg",
    siteUrl,
    uploadsDir,
  ) === null,
  "Посторонний путь ошибочно принят",
);
pass("посторонние и небезопасные пути отклоняются");

assertCondition(
  telegramPhotoContentType("photo.png") === "image/png"
    && telegramPhotoContentType("photo.webp") === "image/webp"
    && telegramPhotoContentType("photo.jpg") === "image/jpeg",
  "MIME-тип фотографии определён неверно",
);
pass("Telegram получает корректный MIME-тип файла");

console.log("");
console.log("TELEGRAM LOCAL PHOTO UPLOAD E2E: OK");
console.log("Проверены local upload mapping, path safety и MIME-типы.");
