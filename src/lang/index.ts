// Plugin-local i18n. Translation tables travel with the plugin
// bundle. The plugin reads the host's locale via `useRuntime()` and
// looks up its own table reactively.

import { computed } from "vue";
import { useRuntime } from "gui-chat-protocol/vue";
import en from "./en";
import ja from "./ja";

const MESSAGES = { en, ja } as const;
type LocaleKey = keyof typeof MESSAGES;

function isSupportedLocale(value: string): value is LocaleKey {
  return value in MESSAGES;
}

export function useT() {
  const { locale } = useRuntime();
  return computed(() => (isSupportedLocale(locale.value) ? MESSAGES[locale.value] : MESSAGES.en));
}
