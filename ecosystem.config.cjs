const path = require("node:path");

const root = __dirname;

module.exports = {
  apps: [
    {
      name: "accord-api",
      cwd: path.join(root, "apps/api"),
      script: path.join(root, "apps/api/dist/index.js"),
      node_args: [`--env-file=${path.join(root, ".env")}`],
      exec_mode: "fork",
      instances: 1,
      watch: false,
      env: {
        NODE_ENV: "production",
        API_HOST: "127.0.0.1",
      },
    },
  ],
};
