import prettier from "eslint-config-prettier";

export default [
  {
    files: ["**/*.ts"],
    languageOptions: { parser: "@typescript-eslint/parser" },
    plugins: { prettier },
    rules: {
      "prettier/prettier": "error"
    }
  }
];