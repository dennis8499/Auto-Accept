# Codex Auto-Accept

在 **VS Code 終端**中自動接受 Codex CLI 的單次操作核准。每個終端有獨立開關，預設 OFF；一般提問與方案選擇保留手動回答。

## 安裝

需要 VS Code 1.93 以上，以及已安裝並登入的 Codex CLI。一般終端必須啟用 [Shell Integration](https://code.visualstudio.com/docs/terminal/shell-integration)。Windows 可使用 **PowerShell 7（pwsh）**、Git Bash，或下方的 **CMD 專用啟動指令**；Windows PowerShell 5 不支援自動注入 Shell Integration。

使用本機建置的 `codex-auto-accept-0.1.4.vsix`，或從 [GitHub Releases](https://github.com/dennis8499/Auto-Accept/releases/latest) 下載已發布的版本，再於 VS Code 的擴充套件頁面選擇「… → Install from VSIX…」開啟它。也可以在這個專案目錄執行：

```powershell
code --install-extension .\codex-auto-accept-0.1.4.vsix
```

安裝後重新開啟受支援的終端並執行 `codex`；使用 CMD 時，請從命令選單執行專用啟動指令。

## 使用

1. 在 VS Code 的終端執行 `codex`。
2. 點擊右下角的 **Codex Auto-Accept: OFF**，開啟目前終端的自動核准。
3. 狀態變為 **ON** 表示已接上 Codex 輸出，支援的操作核准會自動送出單次同意 `y`。若顯示 **等待 Codex**，請結束目前工作階段，在 Shell Integration 啟用後重新執行 `codex`。
4. 再次點擊即可關閉。切換到其他終端時，開關顯示該終端的狀態。

也可以從命令選單執行 **Codex Auto-Accept: 切換目前終端的自動核准**，命令 ID 為 `codexAutoAccept.toggle`。

可以先執行 Codex 再開啟開關；擴充套件已觀察到、正在等待回答的核准也會處理。開關在同一終端的後續 Codex 工作階段中保留，工作階段之間顯示 **等待 Codex**；關閉終端或重新啟動 VS Code 後回到 OFF。

| 狀態 | 意義 |
| --- | --- |
| OFF | 自動核准已關閉 |
| 等待 Codex | 開關已開啟，等待接上可辨識的 Codex 工作階段；依工具提示重新執行 `codex` |
| ON | 正在監看 Codex，完整且支援的核准選單會自動接受 |

### 使用 CMD（Windows）

1. 在命令選單執行 **Codex Auto-Accept: 以 CMD 啟動 Codex**（`codexAutoAccept.startCmd`）。
2. 擴充套件開啟專用 CMD 終端，直接執行 PATH 中的 `codex`，不另外詢問啟動參數。
3. 點擊右下角的 **Codex Auto-Accept: OFF** 開啟自動核准；這個終端同樣預設 OFF。

工作目錄優先使用目前編輯檔案所屬的工作區，其次為第一個工作區；沒有工作區時使用使用者目錄。專用終端在 Codex 結束時一併關閉，重新載入 VS Code 後不會復原。

按 Ctrl+C 時，CMD 若詢問是否終止批次工作（`Terminate batch job (Y/N)?`），仍需手動回答；也可以直接關閉終端。

此指令需要擴充套件執行於 Windows。它只監看由此指令啟動的 Codex；既有 CMD 終端、已經執行中的 Codex，以及 VS Code 外的 CMD 視窗不會被接管。要使用 `resume`、`fork` 或自訂啟動參數，請使用上方受支援的一般終端。

## 接受的提示

| 操作 | 支援的英文標題 | 同意範圍 |
| --- | --- | --- |
| 指令執行 | Would you like to run the following command? | 單次 |
| 檔案修改 | Would you like to make the following edits? | 單次 |
| 網路存取 | Do you want to approve network access to "…"? | 單次 |
| 終端輸入 | Would you like to send input to terminal …? | 單次 |
| 額外權限 | Would you like to grant these permissions? | 本回合 |

指令執行標題也支援 `Would you like to run the following command ?`，問號前可有空白或換行。同一核准的標題空白或換行改變時，不會重複送出輸入；Audit Log 保留當下可見的原始標題、Environment、理由與指令格式。

只有完整核准畫面明確顯示單次同意 `(y)`、拒絕選項及確認提示時才會動作。使用 `y` 快捷鍵，所以即使游標移到其他選項，也不會選取「之後不再詢問」。重繪同一個核准不會再次送出輸入。

指令、程式與 Git 操作使用相同的核准辨識。理由或指令內的 `needs your approval`、表單文字與反引號屬於操作內容，不會被當成一般提問。每個完成的重繪畫面都會處理，因此終端合併輸出時，已結束核准後的下一次相同操作也能接受。

一般選擇題、MCP 資料填寫表單、帳號登入、專案信任設定與未知提示保留手動回答。若你要手動處理某次操作核准，先關閉該終端的開關。

在受支援的一般終端中，可直接執行 `codex`、`codex.exe`、`codex.cmd`、`codex.ps1`、完整路徑、PowerShell 的 `&` 啟動方式，以及 `npx @openai/codex`，包含 `resume`、`fork`。非互動子命令、管線、複合 shell 指令及自訂包裝程式不啟用自動輸入。CMD 專用終端只啟動 PATH 中的 `codex`。

## 排除問題

開啟 **View → Output → Codex Auto-Accept** 查看 Audit Log，或將滑鼠移到狀態列查看目前原因。頻道使用 VS Code 原生 `LogOutputChannel`，每筆訊息是單行 JSON，外層由 VS Code 加上時間與日誌等級。請將頻道等級設為 **Info、Debug 或 Trace** 查看完整事件；Warning 或 Error 會省略一般操作紀錄。

日誌記錄擴充套件啟停、終端開關、Shell Integration 就緒、監看開始／結束、核准送出、未支援提示與錯誤。共用欄位為 `timestamp`（UTC ISO 8601）、`event` 與 `runId`；終端事件另有 `terminalId`、`terminalName`，工作階段事件另有 `sessionId`。識別碼可區分同名終端及連續執行；結束原因與當時取得的 `exitCode` 也會記錄。

`approval.sent` 表示已送出單次核准輸入，包含 `kind` 與 `content`，不代表操作已成功執行。`content` 保留確認當下可見的核准標題、理由、指令、檔案差異或其他操作內容，排除核准選單及歷史畫面；換行、引號及控制字元以 JSON 跳脫保存。內容不自動摘要或遮罩，CLI 省略或畫面未顯示的資訊不補推。

日誌檔案由 VS Code 保存及清理。可在命令選單執行 **Developer: Open Logs Folder**，於目前或過去工作階段的 `window*/exthost` 下尋找 `Codex Auto-Accept.log`（檔名前可能有編號）。重新開啟 VS Code 後，Output 顯示新的工作階段；舊紀錄從日誌資料夾查看，保存期限依 VS Code 原生清理規則。同一提示重繪不會重複記錄核准或相同診斷；一般重繪途中短暫不完整的畫面會等穩定後才記錄。

- **沒有 Shell Integration：**在 VS Code 設定啟用 `terminal.integrated.shellIntegration.enabled`，重新開啟受支援的終端。在 Windows 可使用 PowerShell 7（`pwsh`），或從命令選單以 CMD 專用指令啟動 Codex。
- **CMD 找不到 Codex 或啟動失敗：**確認 `codex` 已加入擴充套件所在 Windows 環境的 PATH，重新開啟 VS Code 後再執行 CMD 專用指令。啟動失敗時會顯示原因，該工作階段不會自動送出輸入。
- **CMD 啟動逾時：**啟動器在 15 秒內未接上 Codex 輸出時會顯示原因並關閉自動核准。可繼續手動操作，或關閉終端後重新執行 CMD 專用指令。
- **VS Code 1.93 的快速相同核准：**舊版終端可能合併兩次核准之間的過場畫面。無法確認前次已結束時，下一次相同操作會保留手動回答。
- **找不到目前的 Codex 指令：**擴充套件無法接管在它啟動前就已執行的指令；請重新執行 `codex`。
- **等待 Codex 或監看中斷：**開關仍已開啟，但尚未接上輸出或原工作階段已被其他指令取代。查看工具提示，結束目前工作階段後重新執行 `codex`；CMD 請重新執行專用啟動指令。
- **未知格式或快捷鍵：**目前支援英文核准介面與預設 `y` 快捷鍵；保留手動回答。
- **選項未完整顯示：**若終端太小，Codex 可能裁掉拒絕選項。放大終端以顯示完整核准選單，或手動核准。
- **輸出讀取或送出失敗：**該終端會自動切換 OFF。修正問題、重新執行 Codex 後再開啟。

此版本作用於終端中的 Codex CLI。Codex 側邊欄與桌面 App 的核准流程不在此擴充套件的支援範圍。

## 開發與測試

建置工具需要 Node.js 22 以上。執行時沒有額外 npm 相依套件。

```powershell
npm ci --ignore-scripts
npm test
npm run package
npm run verify:package
```

`npm test` 使用 Node 內建測試器。按 F5 可以啟動擴充套件開發宿主；`npm run watch` 可持續編譯。

Windows 的 CMD 與 PowerShell 終端整合測試使用獨立 VS Code 使用者資料與擴充套件目錄，不變更日常使用的設定：

```powershell
$env:CODEX_AUTO_ACCEPT_PWSH = (Get-Command pwsh).Source
npm run test:integration
```

若 PowerShell 尚未加入 PATH，將 `CODEX_AUTO_ACCEPT_PWSH` 設為 `pwsh.exe` 的完整路徑。`CODEX_AUTO_ACCEPT_VSCODE` 可指定 VS Code 執行檔；未指定時使用 Windows 的使用者安裝路徑。

`CODEX_AUTO_ACCEPT_SUITE` 預設為 `all`，也可設為 `cmd` 或 `powershell` 單獨執行對應整合測試。CMD 測試會產生模擬 CLI，驗證專用啟動指令及含中文、空白與特殊字元的路徑。

可另外設定 `CODEX_AUTO_ACCEPT_LIVE_CLI` 為已登入的 `codex.exe` 完整路徑，執行實際 CLI 核准測試。此測試只在 `.cache/integration/live-workspace` 建立 `codex-live-smoke.txt`，會使用 Codex 額度。測試結果在 `.cache/integration/results.txt`。

## 來源與授權

改編自 [varfmx/claude-code-auto-accept](https://github.com/varfmx/claude-code-auto-accept)，原作者為 Fernando Valderrábano。原始 MIT 授權與著作權聲明保留於 [LICENSE](LICENSE)，來源紀錄見 [UPSTREAM.md](UPSTREAM.md)。

核准格式參考 [官方 Codex 原始碼](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/approval_overlay.rs)。套件使用本地 publisher `local-codex`，供本機安裝。
