// Vue entry — exports the canvas component the host runtime plugin
// loader dynamic-imports as `dist/vue.js`.

import View from "./View.vue";
import { TOOL_DEFINITION } from "./definition";

export const plugin = {
  toolDefinition: TOOL_DEFINITION,
  viewComponent: View,
};
