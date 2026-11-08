// PM2: 5 procesos independientes (ver docs/DEPLOY.md).
//   ff-web              Aplicación Next.js
//   ff-worker-generate  Generación de contenido y automatización por página (cola "automation")
//   ff-worker-render    Renderizado de Reels con FFmpeg (cola "render")
//   ff-worker-publish   Publicación en Facebook + escáner de vencimientos (cola "publish")
//   ff-scheduler        Planificador: registra las tareas periódicas (UNA sola instancia)
//
// Las variables de entorno se leen del archivo .env del proyecto (Next.js y los workers lo cargan solos).
/* eslint-disable @typescript-eslint/no-require-imports -- archivo CommonJS de PM2 */
const fs = require("fs");
const path = require("path");
const cwd = __dirname;
// PM2 no lee el .env: el puerto se toma de la shell o, si no está, de la línea PORT= del .env (por defecto 3000).
const port = (() => {
  if (process.env.PORT) return process.env.PORT;
  try {
    const m = fs.readFileSync(path.join(cwd, ".env"), "utf8").match(/^\s*PORT\s*=\s*"?(\d+)"?/m);
    if (m) return m[1];
  } catch {}
  return "3000";
})();
// Rutas RELATIVAS al cwd: PM2 ejecuta el script sin comillas, así que una ruta absoluta con espacios fallaría.
const tsx = "node_modules/tsx/dist/cli.mjs";

const base = {
  cwd,
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  min_uptime: "20s",
  max_restarts: 20,
  restart_delay: 5000,
  time: true,
  merge_logs: true,
};
const worker = (name, file, extra = {}) => ({
  ...base,
  name,
  script: tsx,
  args: file,
  interpreter: "node",
  // `server-only` falla fuera de Next salvo con esta condición de resolución
  env: { NODE_ENV: "production", NODE_OPTIONS: "--conditions=react-server" },
  kill_timeout: 30000, // tiempo para cerrar el worker de forma ordenada (SIGTERM)
  max_memory_restart: "1500M",
  ...extra,
});

module.exports = {
  apps: [
    {
      ...base,
      name: "ff-web",
      script: "node_modules/next/dist/bin/next",
      args: `start -p ${port} -H 127.0.0.1`, // solo escucha en loopback: lo expone Nginx
      env: { NODE_ENV: "production" },
      max_memory_restart: "1G",
      kill_timeout: 10000,
    },
    worker("ff-worker-generate", "src/workers/generate.ts"),
    worker("ff-worker-render", "src/workers/render.ts", { kill_timeout: 90000, max_memory_restart: "2G" }), // FFmpeg: más memoria y más tiempo de cierre
    worker("ff-worker-publish", "src/workers/publish.ts"),
    // Planificador: nunca más de una instancia (aun así las tareas periódicas son idempotentes en Redis)
    worker("ff-scheduler", "src/workers/scheduler.ts", { max_memory_restart: "500M" }),
  ],
};
