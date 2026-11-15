const { createInterface, emitKeypressEvents } = require("node:readline");
const { stdin, stdout } = require("node:process");
const { pool } = require("./database");
const { resetAdminPassword } = require("./admin");
const { RequestError } = require("./orders");

function promptVisible(question) {
  const terminal = createInterface({ input: stdin, output: stdout });
  return new Promise((resolve) => {
    terminal.question(question, (answer) => {
      terminal.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this command in an interactive terminal to hide password input."));
  }

  stdout.write(question);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    let finished = false;
    function finish(error) {
      if (finished) return;
      finished = true;
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    }
    function onKeypress(character, key = {}) {
      if (key.ctrl && key.name === "c") {
        finish(new Error("Password reset was cancelled."));
      } else if (key.name === "return" || key.name === "enter") {
        finish();
      } else if (key.name === "backspace") {
        password = password.slice(0, -1);
      } else if (character && !key.ctrl && password.length < 16) {
        password += character;
      }
    }
    stdin.on("keypress", onKeypress);
  });
}

async function main() {
  const username = await promptVisible("Existing admin username: ");
  const password = await promptHidden("New password (7-16 characters): ");
  const confirmation = await promptHidden("Confirm new password: ");
  if (password !== confirmation) {
    stdout.write("The passwords do not match. No changes were made.\n");
    process.exitCode = 1;
    return;
  }

  try {
    const admin = await resetAdminPassword(pool, username, password);
    stdout.write(`Password updated for admin "${admin.username}".\n`);
  } catch (error) {
    if (error instanceof RequestError) {
      stdout.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      console.error("Could not reset admin password:", error.code || "database error");
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message || "Could not reset admin password.");
  process.exitCode = 1;
}).finally(() => {
  pool.end().catch((error) => {
    console.error("Could not close the database pool:", error.code || "database error");
    process.exitCode = 1;
  });
});
