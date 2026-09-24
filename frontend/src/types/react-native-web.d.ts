import "react-native";

// Props honoured by react-native-web but absent from React Native's own typings.
// No-ops on iOS/Android.
declare module "react-native" {
  interface TextInputProps {
    /** Web only: rendered as `aria-required`. */
    accessibilityRequired?: boolean;
  }
}
