import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const params = new URLSearchParams(window.location.search);
if (params.get("popup") === "1") {
  document.documentElement.classList.add("extension-popup");
}

createRoot(document.getElementById("root")!).render(<App />);
