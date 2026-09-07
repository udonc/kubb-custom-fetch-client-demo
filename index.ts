import { getBook } from "./generated/clients";
import type { ApiError } from "./generated/types/ApiError";
import type { Book } from "./generated/types/Book";

try {
  const result = await getBook({
    path: { isbn: "4299039009" },
    throwOnError: false,
  });

  switch (result.status) {
    case 200:
      result.data satisfies Book;
      break;
    case 404:
      result.error satisfies ApiError;
      break;
    default:
      result satisfies never;
  }
} catch (e) {
  console.error("transport error", e);
}
