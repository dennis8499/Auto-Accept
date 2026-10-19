# 驗證紀錄

## 2026-10-19：CMD 專用啟動指令

版本：0.1.4。Node.js 24.21.0、Windows x64、可攜式 PowerShell 7.6.7；使用 VS Code 1.93 API 型別編譯。

- 138 項 Node 測試與 TypeScript 嚴格模式編譯通過。新增 CMD 預設 OFF、啟動與工作目錄、啟動逾時、逾時後關閉只回報一次、讀取／送出失敗及清理驗證；既有五種核准與去重測試保留。
- CMD 啟動器測試涵蓋 `.exe`／`.cmd`、中文／空白／`%`／`!`／`&`／`^`／括號路徑、零參數、工作目錄、尾端接管、正常與非零退出碼，以及缺少或不支援的啟動器。
- VS Code 1.142.0 與最低支援的 1.93.0 各完成 48 項隔離整合檢查，涵蓋既有 PowerShell 回歸及 CMD 的五種核准、手動回答界線、去重、終端隔離、關閉、Ctrl+C、缺少 Codex、原生日誌 JSON、Output 顯示與宿主退出後日誌保存。
- VS Code 1.93 的 ConPTY 可能將過快的中間畫面合併到下一個畫面。產生的終端 fixture 將 `Working...` 與下一張核准分開寫入並間隔 250 ms，等待可觀察的結束畫面；原始 fixture 與合併 frame 的單元案例未修改。舊版若未提供可辨識的過場，下一次相同操作會保留手動回答。
- 套件驗證指令 `npm run verify:package` 檢查 0.1.4 版本、兩個命令、CMD 啟動器資源、六個已編譯模組與本機檔案一致、開發檔案排除及原始 MIT 授權。
- 本次使用隔離測試 fixture，未重跑已登入的實際 Codex CLI。一般 Windows 程序權限下執行相同測試，未修改 VS Code 安裝目錄 ACL、日常使用者設定或 Codex 全域設定。

## 2026-10-19：指令核准標題空白修正

版本：0.1.3。

- Node.js 24.21.0；TypeScript 嚴格模式編譯，使用 VS Code 1.93 API 型別。
- 124 項 Node 測試通過，新增完整 `Environment: local`／`Set-Content` 案例，以及問號前空白、Tab、換行、標題指紋一致性、完整選單檢查、重繪去重與原始 Audit Log 內容驗證。
- 23 項隔離 VS Code 開發宿主整合檢查通過，包含五種核准、連續與相同操作、手動回答界線、原生日誌 JSON、Output 顯示及宿主退出後日誌保存。
- 0.1.3 VSIX 套件版本、六個已編譯模組與本機建置一致、開發檔案排除及原始 MIT 授權檢查通過。
- 本次使用隔離測試 fixture；實際 Codex CLI 的先前驗證保留於下方紀錄。
- 受限程序無法讀取 VS Code 安裝目錄時，以一般 Windows 程序權限執行相同隔離測試，未變更安裝目錄 ACL 或日常設定。

## 2026-10-15：Audit Log

版本：0.1.2。

- Node.js 24.21.0、VS Code 1.141.2（Windows x64）、可攜式 PowerShell 7.6.7；使用 VS Code 1.93 API 型別編譯。
- 114 項 Node 測試通過，包含原有 100 項及五種核准的格式化內容、歷史／選單邊界、JSON 單行跳脫、同名終端／工作階段識別、最新確認畫面、核准與診斷去重、失效 sender 及日誌寫入失敗隔離。
- 23 項開發宿主整合檢查通過：原有 20 項 PowerShell 情境，加上原生日誌 JSON、Output 文字模型顯示，以及宿主退出後檔案仍可讀取。
- 原生日誌確認保存 13 筆 `approval.sent`，涵蓋五種核准；每筆保留 VS Code 時間／等級前綴及可解析 JSON，操作內容已清除 ANSI，未支援提示使用警告等級。
- 0.1.2 VSIX 套件內容、版本、既有命令、六個已編譯模組與本機建置一致、開發檔案排除及原始 MIT 授權檢查通過。
- 完整結果在 `.cache/integration/results.txt`；原生日誌實際路徑在 `.cache/integration/audit-log-path.txt`。
- 本次使用隔離測試 fixture，未重跑消耗額度的實際 Codex CLI 測試；下方保留先前的實際 CLI 驗證紀錄。受限程序無法讀取 VS Code 安裝目錄時，以一般 Windows 程序權限執行相同隔離測試，未變更安裝目錄 ACL 或日常設定。

## 2026-10-14：初次驗證

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

- `.cache/integration/results.txt`：最近一次隔離開發宿主整合結果。
- `.cache/integration/current-all-results.txt`：VS Code 1.142.0 的完整整合結果。
- `.cache/integration/vscode-1.93-all-results.txt`：VS Code 1.93.0 的完整整合結果；同名前綴另存執行事件與原生日誌路徑。
- `.cache/integration/live-results.txt`：包含實際 CLI 核准成功的測試結果。
- `.cache/integration/live-codex-regression-trace.txt`：用於最後辨識器重播的實際 CLI 紀錄。
- `codex-auto-accept-0.1.4.vsix`：CMD 專用啟動指令的本機安裝套件。

## 界線

實際 CLI 測試使用英文介面與預設 y 快捷鍵。終端必須完整顯示核准選項；選項遭裁切時保留手動核准，並提示放大終端。

ON 表示已接上可辨識的 Codex 工作階段；開關已開啟但尚未接上、或輸出串流／工作階段已結束時顯示「等待 Codex」。擴充套件啟動前已執行的 Codex 仍需重新啟動，以取得新的終端輸出串流。

本次已重現並修正 `command ?` 問號前空白造成的漏判；同一核准切換標題空白或換行時只送出一次輸入，並保留確認當下的原始可見內容。

測試使用獨立 VS Code 使用者資料目錄；可攜式 PowerShell、終端紀錄與測試檔均留在 .cache，沒有修改日常使用的 VS Code 設定。受限環境的 Electron 啟動失敗後，以一般 Windows 程序權限執行隔離測試；沒有變更 VS Code 安裝目錄 ACL 或 Codex 的全域沙箱／核准設定。
