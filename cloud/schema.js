// Создаёт таблицы в базе mizanscena-db (запускается один раз с этого компьютера).
// Доступ — временным IAM-токеном вашего входа в yc: он передаётся через окружение и нигде не печатается.
'use strict';
const path = require('path');
const { Driver, TokenAuthService, TableDescription, Column, TableIndex, Types } = require(path.join(__dirname, 'function', 'node_modules', 'ydb-sdk'));

const T = { U: Types.optional(Types.UTF8), N: Types.optional(Types.UINT64), D: Types.optional(Types.TIMESTAMP), B: Types.optional(Types.BOOL) };
const table = (cols, keys, index) => {
  const t = new TableDescription(Object.entries(cols).map(([n, ty]) => new Column(n, T[ty])), keys);
  if (index) t.withIndex(new TableIndex(index.name).withIndexColumns(...index.cols));
  return t;
};
const TABLES = {
  users: table({ id: 'U', name: 'U', email: 'U', avatar: 'U', seen: 'D' }, ['id']),
  projects: table({ id: 'U', owner: 'U', name: 'U', data: 'U', version: 'N', updated: 'D', updated_by: 'U', deleted: 'B' }, ['id']),
  members: table({ user_id: 'U', project_id: 'U', role: 'U' }, ['user_id', 'project_id'], { name: 'by_project', cols: ['project_id'] }),
  invites: table({ code: 'U', project_id: 'U', role: 'U', created_by: 'U', created: 'D' }, ['code']),
};

(async () => {
  const driver = new Driver({ endpoint: 'grpcs://ydb.serverless.yandexcloud.net:2135', database: process.argv[2], authService: new TokenAuthService(process.env.YC_IAM_TOKEN) });
  if (!(await driver.ready(15000))) throw new Error('База недоступна');
  for (const [name, desc] of Object.entries(TABLES)) {
    try {
      await driver.tableClient.withSession(s => s.createTable(name, desc));
      console.log('таблица', name, 'создана');
    } catch (e) {
      console.log('таблица', name, /exist/i.test(String(e.message)) ? 'уже есть' : 'ошибка: ' + e.message);
    }
  }
  await driver.destroy();
})().catch(e => { console.error(e.message); process.exit(1); });
