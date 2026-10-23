internal import Expo
import React
import ReactAppDependencyProvider

@main
class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {
  // Not assigned here: ExpoAppSceneDelegate writes it (provider.window = window) when the
  // scene connects. Kept because expo-system-ui and similar modules read
  // UIApplication.shared.delegate?.window. Do not remove.
  var window: UIWindow?

  // private(set): ExpoAppSceneDelegate only reads these; a nil here would hit its fatalError.
  private(set) var reactNativeDelegate: ExpoReactNativeFactoryDelegate?
  private(set) var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let delegate = ReactNativeDelegate()
    let factory = ExpoReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    // Window creation moved to ExpoAppSceneDelegate.scene(_:willConnectTo:options:).
    // iOS 27 enforces scene-based lifecycle; UIKit calls that method instead of
    // letting AppDelegate create the window directly.

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }

  // iOS 27 requires scene-lifecycle adoption. ExpoAppDelegate does not implement this
  // method, so no `override` keyword. ExpoAppSceneDelegate handles window creation and
  // React Native startup.
  // TODO: add `override` (and call super) if ExpoAppDelegate gains configurationForConnecting.
  func application(
    _ application: UIApplication,
    configurationForConnecting connectingSceneSession: UISceneSession,
    options: UIScene.ConnectionOptions
  ) -> UISceneConfiguration {
    let config = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    // Only the main window scene starts React Native; other roles (e.g. external display)
    // must not start a second bridge.
    if connectingSceneSession.role == .windowApplication {
      config.delegateClass = ExpoAppSceneDelegate.self
    }
    return config
  }

  // Linking API
  public override func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)
  }

  // Universal Links
  public override func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    let result = RCTLinkingManager.application(application, continue: userActivity, restorationHandler: restorationHandler)
    return super.application(application, continue: userActivity, restorationHandler: restorationHandler) || result
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {
  // Extension point for config-plugins

  override func sourceURL(for bridge: RCTBridge) -> URL? {
    // needed to return the correct URL for expo-dev-client.
    bridge.bundleURL ?? bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")
#else
    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
