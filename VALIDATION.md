# 驗證紀錄

日期：2026-10-14。

- Node.js 24.21.0。
- VS Code 1.141.1（Windows x64）。
- PowerShell 7.6.7，可攜式版本，放在專案測試快取。
- 本機 Codex CLI 0.162.0-alpha.17.2。

## 已通過

- TypeScript 嚴格模式編譯，使用 VS Code 1.93 的 API 型別。
- 79 項 Node 內建測試：Codex 啟動辨識、五種操作核准、ANSI 分段與畫面重繪、儲存上限、去重、快速連續核准、關閉開關及生命週期清理。
- PowerShell 終端的 13 項整合情境：預設 OFF、提示等待途中開啟、五種單次核准、終端隔離、一般提問、MCP 表單、未知快捷鍵、其他程式及關閉後不輸入。
- 本機 Codex CLI 的實際核准：以單次啟動參數指定 read-only sandbox、on-request 與 user reviewer，觀察原生核准選單後，由擴充套件送出 y，成功建立內容為 codex-auto-accept-ok 的測試檔。
- VSIX ZIP 結構、套件名稱／版本／publisher、公開命令、五個已編譯模組、繁體中文說明與原始 MIT 授權內容檢查。

## 界線

實際 CLI 測試使用英文介面與預設 y 快捷鍵。終端必須完整顯示核准選項；選項遭裁切時保留手動核准，並提示放大終端。

測試使用獨立 VS Code 使用者資料目錄；可攜式 PowerShell、終端紀錄與測試檔均留在 .cache，沒有修改日常使用的 VS Code 設定。
