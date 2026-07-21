import { mount } from "svelte";
import App from "./App.svelte";
import { installButtonTooltips } from "./lib/button-tooltips";
import "./styles/app.css";

const app = mount(App, {
  target: document.getElementById("app")!,
});
installButtonTooltips(document);

export default app;
