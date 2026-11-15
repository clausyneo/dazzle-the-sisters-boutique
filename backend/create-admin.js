const { createInterface, emitKeypressEvents } = require("node:readline");
const { stdin, stdout } = require("node:process");
const { pool } = require("./database");
const { createAdminAccount } = require("./admin");
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
    stdout.write("This terminal cannot hide password input; use a private terminal.\n");
    return promptVisible(question);
  }

  stdout.write(question);
  emitKeypressEvents(stdin);
  stdin.setRawMode(true);
  stdin.resume();
  return new Promise((resolve, reject) => {
    let password = "";
    function finish(error) {
      stdin.removeListener("keypress", onKeypress);
      stdin.setRawMode(false);
      stdout.write("\n");
      if (error) reject(error);
      else resolve(password);
    }
    function onKeypress(character, key = {}) {
      if (key.ctrl && key.name === "c") {
        finish(new Error("Admin creation was cancelled."));
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
  const username = await promptVisible("Admin username or email: ");
  const password = await promptHidden("Admin password (7-16 characters): ");
  try {
    const admin = await createAdminAccount(pool, username, password);
    stdout.write(`Created admin account "${admin.username}" (ID ${admin.adminId}).\n`);
  } catch (error) {
    if (error instanceof RequestError) {
      stdout.write(`${error.message}\n`);
      process.exitCode = 1;
    } else {
      console.error("Could not create admin account:", error.code || "database error");
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message || "Could not create admin account.");
  process.exitCode = 1;
}).finally(() => {
  pool.end().catch((error) => {
    console.error("Could not close the database pool:", error.code || "database error");
    process.exitCode = 1;
  });
});
