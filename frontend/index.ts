// First: Intl.PluralRules for Hermes, before anything initialises i18next (#2754).
import "./src/i18n/pluralRulesPolyfill";

import { registerRootComponent } from "expo";

import App from "./App";

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
