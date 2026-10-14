# 驗證紀錄

日期：2026-10-14。版本：0.1.1。

- Node.js 24.21.0。
- VS Code 1.141.1（Windows x64）。
- PowerShell 7.6.7，可攜式版本，放在專案測試快取。
- 本機 Codex CLI 0.162.0-alpha.17.2。

## 已通過

- TypeScript 嚴格模式編譯，使用 VS Code 1.93 的 API 型別。
- 100 項 Node 內建測試：原有 79 項，以及理由／指令中的核准、表單與反引號文字、合併重繪後連續相同核准、歷史核准與一般選單隔離、診斷穩定與去重、OFF／等待 Codex／ON、重複開始事件、舊工作階段的結束／錯誤、讀取／送出失敗及關閉時取消輸入。
- PowerShell 終端的 20 項整合情境：原有 13 項，加上理由、程式與 Git 漏判回歸、同一工作階段中四次連續核准（包含後續相同操作）、不完整選單、核准歷史後的選擇題及共用確認提示的一般選單。
- 本機 Codex CLI 的實際核准：以單次啟動參數指定 read-only sandbox、on-request 與 user reviewer，核准理由明確包含 `This command needs your approval to validate the extension.`。擴充套件自動送出 y，成功建立內容為 codex-auto-accept-ok 的測試檔。
- 最終辨識器重播上述實際 CLI 終端紀錄，成功辨識包含回歸理由的 5 個核准畫面；一般選單隔離的最後修改仍可辨識實際核准。
- 0.1.1 VSIX ZIP 結構、套件名稱／版本／publisher、既有切換命令、五個已編譯模組與本機編譯內容一致、繁體中文說明與原始 MIT 授權內容檢查。

## 驗證結果位置

- `.cache/integration/results.txt`：最後一輪的 20 項 PowerShell 整合結果；該輪未重複啟動實際 CLI。
- `.cache/integration/live-results.txt`：包含實際 CLI 核准成功的測試結果。
- `.cache/integration/live-codex-regression-trace.txt`：用於最後辨識器重播的實際 CLI 紀錄。
- `codex-auto-accept-0.1.1.vsix`：已驗證的本機安裝套件。

## 界線

實際 CLI 測試使用英文介面與預設 y 快捷鍵。終端必須完整顯示核准選項；選項遭裁切時保留手動核准，並提示放大終端。

ON 表示已接上可辨識的 Codex 工作階段；開關已開啟但尚未接上、或輸出串流／工作階段已結束時顯示「等待 Codex」。擴充套件啟動前已執行的 Codex 仍需重新啟動，以取得新的終端輸出串流。

已修正並驗證可重現的漏判與監看狀態問題；使用者原先那一次卡住的完整提示及狀態未提供，無法將該次事件歸因於特定漏洞。

測試使用獨立 VS Code 使用者資料目錄；可攜式 PowerShell、終端紀錄與測試檔均留在 .cache，沒有修改日常使用的 VS Code 設定。受限環境的 Electron 啟動失敗後，以一般 Windows 程序權限執行隔離測試；沒有變更 VS Code 安裝目錄 ACL 或 Codex 的全域沙箱／核准設定。
