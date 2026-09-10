import { pluginFetch } from "@kubb/plugin-fetch";
import { pluginTs } from "@kubb/plugin-ts";
import { defineConfig } from "kubb";
import { pluginHello } from "./kubb-plugins/fetch-neverthrow";

export default defineConfig({
  input: "./openapi.yaml", // 生成元になるOpenAPIスキーマ
  output: {
    path: "./generated", // 生成したコードをどこに出力するか
    clean: true, // 生成のたびに `./generated` ディレクトリを削除する設定
  },
  plugins: [
    pluginHello(),
    pluginTs(),
    pluginFetch({
      baseURL: "https://api.example.com/v1",
    }),
  ],
});
