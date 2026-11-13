# Generates synthetic WAV clips (16 kHz mono) for the STT harness using the built-in Windows speech synthesizer.
# Real recordings of your own voice are better; drop them in tests/fixtures/audio and add them to expected.json.
Add-Type -AssemblyName System.Speech
$out = Join-Path $PSScriptRoot '..\tests\fixtures\audio'
New-Item -ItemType Directory -Force -Path $out | Out-Null

$clips = [ordered]@{
  'cmd-poll-win-loss'      = 'Holler, poll win or loss.'
  'cmd-poll-duration'      = 'Holler, poll cats or dogs for two minutes.'
  'cmd-poll-three'         = 'Holler, poll red or blue or green.'
  'cmd-end-poll'           = 'Hey holler, end the poll.'
  'cmd-cancel-poll'        = 'Holler, cancel the poll.'
  'cmd-repeat-poll'        = 'Holler, repeat poll.'
  'cmd-predict'            = 'Holler, predict win or loss.'
  'cmd-lock'               = 'Holler, lock the prediction.'
  'fp-poll-chat'           = 'I think we should poll chat about whether to go left or right.'
  'fp-mid-sentence'        = 'My friend told me to holler poll win or loss but I said no.'
  'fp-gameplay'            = 'Okay chat, push forward, win or loss we keep going, nice shot!'
  'fp-end'                 = 'We need to end this round quickly and cancel the plan.'
}

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.Rate = 0
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
foreach ($name in $clips.Keys) {
  $path = Join-Path $out "$name.wav"
  $synth.SetOutputToWaveFile($path, $fmt)
  $synth.Speak($clips[$name])
  Write-Host "wrote $path"
}
$synth.SetOutputToNull()
$synth.Dispose()
