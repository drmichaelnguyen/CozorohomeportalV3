$base = 'http://127.0.0.1:4111/prospect/ask'
$k1 = 'qa-improve-win-11'
$k2 = 'qa-improve-win-12'

function Ask($key, $q) {
  $body = @{ conversationKey = $key; question = $q } | ConvertTo-Json -Compress
  $resp = Invoke-RestMethod -Method Post -Uri $base -ContentType 'application/json; charset=utf-8' -Body $body
  Write-Output ("Q: " + $q)
  Write-Output ("A: " + $resp.answer)
  Write-Output "---"
}

Ask $k2 'uu dai nhiu ma nhieu'
Ask $k2 'la bao nhieu'
Ask $k1 'phong bao nhieu nguoi'
Ask $k1 'mot phong bao nhieu nguoi'
Ask $k1 'dia chi o dau'
Ask $k1 'sao m ngu vay'
