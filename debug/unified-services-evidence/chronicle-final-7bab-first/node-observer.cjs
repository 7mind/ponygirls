// Evidence only; records actual Node entrypoints/exit status without altering tests.
const fs = require('node:fs'); const path = require('node:path');
const directory = process.env.VALIDATION_NODE_RECORDS;
if (directory) {
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `${process.pid}.json`);
  const record = { pid: process.pid, stage: process.env.VALIDATION_STAGE,
    program: process.argv[1] ? path.resolve(process.argv[1]) : null,
    startedAt: new Date().toISOString(), finishedAt: null, exitStatus: null };
  fs.writeFileSync(file, JSON.stringify(record));
  process.on('exit', code => { record.finishedAt = new Date().toISOString(); record.exitStatus = code;
    fs.writeFileSync(file, JSON.stringify(record)); });
}
