/**
 * Browser entry point: inject the stylesheet and mount the shell.
 * Used by the dev harness (index.html) and the standalone build (Step 9).
 */

import { mountShell } from "./app";
import { SHELL_CSS } from "./view";

const style = document.createElement("style");
style.textContent = SHELL_CSS;
document.head.appendChild(style);

const root = document.getElementById("subnet-workbench");
if (root !== null) {
  mountShell(root, { initialHash: window.location.hash });
}
