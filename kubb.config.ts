import { pluginFetch } from "@kubb/plugin-fetch";
import { pluginTs } from "@kubb/plugin-ts";
import { defineConfig } from "kubb";
import { pluginFetchNeverthrow } from "./kubb-plugins/plugin-fetch-neverthrow";

export default defineConfig({
  input: "./openapi.yaml", // 生成元になるOpenAPIスキーマ
  output: {
    path: "./generated", // 生成したコードをどこに出力するか
    clean: true, // 生成のたびに `./generated` ディレクトリを削除する設定
  },
  plugins: [
    pluginTs(),
    pluginFetch({
      baseURL: "https://api.example.com/v1",
    }),
    pluginFetchNeverthrow(), // 自作: plugin-fetch の client を neverthrow で包む
  ],
});
