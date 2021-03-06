"use strict";

const pMap = require("p-map");

const Command = require("@lerna/command");
const npmRunScript = require("@lerna/npm-run-script");
const batchPackages = require("@lerna/batch-packages");
const runParallelBatches = require("@lerna/run-parallel-batches");
const output = require("@lerna/output");
const ValidationError = require("@lerna/validation-error");

module.exports = factory;

function factory(argv) {
  return new RunCommand(argv);
}

class RunCommand extends Command {
  get requiresGit() {
    return false;
  }

  get defaultOptions() {
    return Object.assign({}, super.defaultOptions, {
      bail: true,
      parallel: false,
      prefix: true,
      stream: false,
    });
  }

  initialize() {
    const { script, npmClient = "npm" } = this.options;

    this.script = script;
    this.args = this.options["--"] || [];
    this.npmClient = npmClient;

    if (!script) {
      throw new ValidationError("ENOSCRIPT", "You must specify a lifecycle script to run");
    }

    if (script === "env") {
      this.packagesWithScript = this.filteredPackages;
    } else {
      this.packagesWithScript = this.filteredPackages.filter(pkg => pkg.scripts && pkg.scripts[script]);
    }

    if (!this.packagesWithScript.length) {
      this.logger.success("run", `No packages found with the lifecycle script '${script}'`);

      // still exits zero, aka "ok"
      return false;
    }

    this.batchedPackages = this.toposort
      ? batchPackages(this.packagesWithScript, this.options.rejectCycles)
      : [this.packagesWithScript];
  }

  execute() {
    let chain = Promise.resolve();

    if (this.options.parallel) {
      chain = chain.then(() => this.runScriptInPackagesParallel());
    } else {
      chain = chain.then(() => this.runScriptInPackagesBatched());
    }

    return chain.then(() => {
      this.logger.success("run", `Ran npm script '${this.script}' in packages:`);
      this.logger.success("", this.packagesWithScript.map(pkg => `- ${pkg.name}`).join("\n"));
    });
  }

  getOpts(pkg) {
    return {
      args: this.args,
      npmClient: this.npmClient,
      prefix: this.options.prefix,
      reject: this.options.bail,
      pkg,
    };
  }

  runScriptInPackagesBatched() {
    const runner = this.options.stream
      ? pkg => this.runScriptInPackageStreaming(pkg)
      : pkg => this.runScriptInPackageCapturing(pkg);

    return runParallelBatches(this.batchedPackages, this.concurrency, pkg => runner(pkg));
  }

  runScriptInPackagesParallel() {
    this.logger.info(
      "run",
      "in %d package(s): npm run %s",
      this.packagesWithScript.length,
      [this.script].concat(this.args).join(" ")
    );

    return pMap(this.packagesWithScript, pkg => this.runScriptInPackageStreaming(pkg));
  }

  runScriptInPackageStreaming(pkg) {
    return npmRunScript.stream(this.script, this.getOpts(pkg));
  }

  runScriptInPackageCapturing(pkg) {
    return npmRunScript(this.script, this.getOpts(pkg))
      .then(result => {
        output(result.stdout);
      })
      .catch(err => {
        this.logger.error("run", `'${this.script}' errored in '${pkg.name}'`);

        if (err.code) {
          // log non-lerna error cleanly
          err.pkg = pkg;
        }

        throw err;
      });
  }
}

module.exports.RunCommand = RunCommand;
