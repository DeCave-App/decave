Pod::Spec.new do |s|
  s.name           = 'DecaveLiveActivity'
  s.version        = '1.0.0'
  s.summary        = 'Voice room Live Activity for DeCave'
  s.author         = 'DeCave'
  s.homepage       = 'https://app.de-cave.com'
  s.license        = 'UNLICENSED'
  s.platforms      = { :ios => '16.2' }
  s.source         = { git: '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.swift'
end
