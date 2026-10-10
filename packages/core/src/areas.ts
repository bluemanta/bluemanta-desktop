import type { DatabaseSync } from 'node:sqlite';
import { getRows } from './sql.js';
import type { Area } from './types.js';

/** 种子数据。校验时读 areas 表，不把这份列表写进命令判断。 */
export const DEFAULT_AREAS: readonly Area[] = [
  {
    id: 'work',
    name: '工作',
    role: '职业人、顾问',
    description: '本职工作和客户交付：数云项目、SalesOS 客户项目、FDE',
  },
  {
    id: 'content',
    name: '内容',
    role: '创作者',
    description: '个人品牌与内容运营：小红书、X 账号',
  },
  {
    id: 'product',
    name: '产品',
    role: '构建者',
    description: '自己做的产品和工具：bluemanta Desktop、OnCue、PortDash、个人网站',
  },
  {
    id: 'growth',
    name: '成长',
    role: '学习者',
    description: '学习与个人发展：英语、AI 基础、个人北极星',
  },
  {
    id: 'family',
    name: '家庭',
    role: '家人',
    description: '家庭事务：孩子教育',
  },
];

type AreaRow = {
  id: string;
  name: string;
  role: string;
  description: string;
};

export function listAreas(db: DatabaseSync): Area[] {
  return getRows<AreaRow>(db, 'SELECT id, name, role, description FROM areas ORDER BY rowid ASC');
}

export function areaExists(db: DatabaseSync, id: string): boolean {
  const row = db.prepare('SELECT 1 AS ok FROM areas WHERE id = ?').get(id);
  return row !== undefined;
}
