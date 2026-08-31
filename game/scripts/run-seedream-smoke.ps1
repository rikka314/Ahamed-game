param(
    [string]$PythonCommand = "python"
)

$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms

$gameRoot = Split-Path -Parent $PSScriptRoot
$generatorPath = Join-Path $PSScriptRoot "seedream-smoke.py"
$resultDirectory = Join-Path $gameRoot "test-results\seedream"
$resultLogPath = Join-Path $resultDirectory "last-run.log"

$form = New-Object System.Windows.Forms.Form
$form.Text = "AhaMed Seedream API Smoke Test"
$form.StartPosition = "CenterScreen"
$form.ClientSize = New-Object System.Drawing.Size(540, 190)
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

$label = New-Object System.Windows.Forms.Label
$label.Location = New-Object System.Drawing.Point(22, 20)
$label.Size = New-Object System.Drawing.Size(496, 42)
$label.Text = "Paste ARK_API_KEY below. Input is hidden and the key stays only in process memory."
$form.Controls.Add($label)

$keyBox = New-Object System.Windows.Forms.TextBox
$keyBox.Location = New-Object System.Drawing.Point(25, 72)
$keyBox.Size = New-Object System.Drawing.Size(490, 28)
$keyBox.UseSystemPasswordChar = $true
$keyBox.ShortcutsEnabled = $true
$form.Controls.Add($keyBox)

$runButton = New-Object System.Windows.Forms.Button
$runButton.Location = New-Object System.Drawing.Point(304, 124)
$runButton.Size = New-Object System.Drawing.Size(100, 34)
$runButton.Text = "Generate"
$runButton.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $runButton
$form.Controls.Add($runButton)

$cancelButton = New-Object System.Windows.Forms.Button
$cancelButton.Location = New-Object System.Drawing.Point(415, 124)
$cancelButton.Size = New-Object System.Drawing.Size(100, 34)
$cancelButton.Text = "Cancel"
$cancelButton.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $cancelButton
$form.Controls.Add($cancelButton)

$form.Add_Shown({ $keyBox.Focus() })
$dialogResult = $form.ShowDialog()

if ($dialogResult -ne [System.Windows.Forms.DialogResult]::OK) {
    $form.Dispose()
    exit 2
}

$apiKey = $keyBox.Text.Trim()
$keyBox.Text = ""
$form.Dispose()

if ([string]::IsNullOrWhiteSpace($apiKey)) {
    [System.Windows.Forms.MessageBox]::Show(
        "No API key was entered. No request was made.",
        "Seedream API Smoke Test",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Warning
    ) | Out-Null
    exit 1
}

$exitCode = 1
try {
    $env:ARK_API_KEY = $apiKey
    New-Item -ItemType Directory -Path $resultDirectory -Force | Out-Null
    $commandOutput = & $PythonCommand $generatorPath 2>&1 | Out-String
    $exitCode = $LASTEXITCODE
    $commandOutput | Set-Content -LiteralPath $resultLogPath -Encoding UTF8

    if ($exitCode -eq 0) {
        [System.Windows.Forms.MessageBox]::Show(
            "Seedream API call succeeded. The image and provenance were saved under game\test-results\seedream.",
            "Seedream API Smoke Test Succeeded",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Information
        ) | Out-Null
    }
    else {
        [System.Windows.Forms.MessageBox]::Show(
            "Seedream API call failed. Details were saved to game\test-results\seedream\last-run.log.",
            "Seedream API Smoke Test Failed",
            [System.Windows.Forms.MessageBoxButtons]::OK,
            [System.Windows.Forms.MessageBoxIcon]::Error
        ) | Out-Null
    }
}
catch {
    $exitCode = 1
    $_ | Out-String | Set-Content -LiteralPath $resultLogPath -Encoding UTF8
    [System.Windows.Forms.MessageBox]::Show(
        "The smoke test could not start. Details were saved to game\test-results\seedream\last-run.log.",
        "Seedream API Smoke Test Failed",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
}
finally {
    Remove-Item Env:ARK_API_KEY -ErrorAction SilentlyContinue
    $apiKey = $null
}

exit $exitCode
