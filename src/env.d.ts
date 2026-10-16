// For the chat plugin's type check (tsconfig.plugin.json): .vue files are compiled by vue-tsc / vite.
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<object, object, unknown>;
  export default component;
}
