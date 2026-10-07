Pod::Spec.new do |s|
  s.name           = 'DecaveAudioRoute'
  s.version        = '1.0.0'
  s.summary        = 'Speaker / earpiece routing for DeCave voice rooms'
  s.author         = 'DeCave'
  s.homepage       = 'https://app.de-cave.com'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
