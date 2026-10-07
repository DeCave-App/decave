param(
  [Parameter(Mandatory=$true)][string]$ScriptFile,
  [string]$VmName='Test',
  [Parameter(Mandatory=$true)][string]$SetupFile,
  [int]$TimeoutMs=120000
)
$ErrorActionPreference='Stop'
[xml]$setup=[IO.File]::ReadAllText($SetupFile)
$account=$setup.SelectSingleNode("//*[local-name()='LocalAccount']")
$username=$account.SelectSingleNode("*[local-name()='Name']").InnerText
if ($account.SelectSingleNode("*[local-name()='Password']/*[local-name()='PlainText']").InnerText -ne 'true') {
  throw 'The test-account setup format is unsupported.'
}
$authFile=Join-Path $env:TEMP ('decave-test-vm-auth-'+[guid]::NewGuid()+'.txt')
try {
  [IO.File]::WriteAllText($authFile,$account.SelectSingleNode("*[local-name()='Password']/*[local-name()='Value']").InnerText)
  $script=[IO.File]::ReadAllText((Resolve-Path -LiteralPath $ScriptFile))
  $encoded=[Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
  & 'C:/Program Files/Oracle/VirtualBox/VBoxManage.exe' guestcontrol $VmName run --exe 'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe' --username $username --passwordfile $authFile --wait-stdout --wait-stderr --timeout $TimeoutMs -- -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded
  $result=$LASTEXITCODE
} finally {
  Remove-Item -LiteralPath $authFile -Force -ErrorAction SilentlyContinue
}
exit $result
