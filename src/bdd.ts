export type Operation = 'and' | 'or' | 'xor';
export type Node = { id: number; level: number; low: number; high: number };
export type Limits = { maxNodes: number; maxCacheEntries: number };
export const DEFAULT_LIMITS: Limits = { maxNodes: 100_000, maxCacheEntries: 200_000 };
export class BudgetExceeded extends Error {
  readonly resource: 'nodes' | 'cache';
  constructor(resource: 'nodes' | 'cache') { super(`BDD ${resource} budget exhausted`); this.name = 'BudgetExceeded'; this.resource = resource; }
}

/** IDs 0 and 1 are terminals; all other IDs belong to this manager only. */
export class BDD {
  #order: string[];
  #limits: Limits;
  #nodes: Node[] = [];
  #unique = new Map<string, number>();
  #cache = new Map<string, number>();
  #calls = 0;
  #hits = 0;
  constructor(order: string[], limits: Limits = DEFAULT_LIMITS) {
    if (!Array.isArray(order) || order.length < 1 || order.length > 32 || new Set(order).size !== order.length || order.some(name => typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,31}$/.test(name))) throw new Error('Order must contain 1–32 unique variable names');
    if (!limits || !Number.isSafeInteger(limits.maxNodes) || limits.maxNodes < 0 || limits.maxNodes > 100_000 || !Number.isSafeInteger(limits.maxCacheEntries) || limits.maxCacheEntries < 0 || limits.maxCacheEntries > 200_000) throw new Error('Invalid BDD resource limits');
    this.#order = [...order]; this.#limits = { ...limits };
  }
  get order(): string[] { return [...this.#order]; }
  get limits(): Limits { return { ...this.#limits }; }
  get stats() { return { allocatedNodes: this.#nodes.length, cacheEntries: this.#cache.size, applyCalls: this.#calls, cacheHits: this.#hits }; }
  #check(id: number): void { if (!Number.isSafeInteger(id) || id < 0 || id >= this.#nodes.length + 2) throw new Error('Invalid manager-local BDD node ID'); }
  #level(id: number): number { return id < 2 ? this.#order.length : this.#nodes[id - 2].level; }
  node(id: number): Node | undefined { this.#check(id); return id < 2 ? undefined : { ...this.#nodes[id - 2] }; }
  #make(level: number, low: number, high: number): number {
    if (low === high) return low;
    const key = `${level}:${low}:${high}`; const prior = this.#unique.get(key);
    if (prior !== undefined) return prior;
    if (this.#nodes.length >= this.#limits.maxNodes) throw new BudgetExceeded('nodes');
    const id = this.#nodes.length + 2;
    this.#nodes.push({ id, level, low, high }); this.#unique.set(key, id); return id;
  }
  variable(name: string): number {
    const level = this.#order.indexOf(name); if (level < 0) throw new Error('Variable is absent from order');
    return this.#make(level, 0, 1);
  }
  apply(operation: Operation, left: number, right: number): number {
    if (!['and', 'or', 'xor'].includes(operation)) throw new Error('Unknown Boolean operation');
    this.#check(left); this.#check(right); return this.#apply(operation, left, right);
  }
  #apply(operation: Operation, left: number, right: number): number {
    this.#calls++;
    if (left > right) [left, right] = [right, left]; // All supported operations commute.
    if (operation === 'and') { if (left === 0) return 0; if (left === 1 || left === right) return right; }
    if (operation === 'or') { if (left === 0 || left === right) return right; if (left === 1) return 1; }
    if (operation === 'xor') { if (left === 0) return right; if (left === right) return 0; }
    const key = `${operation}:${left}:${right}`; const known = this.#cache.get(key);
    if (known !== undefined) { this.#hits++; return known; }
    const level = Math.min(this.#level(left), this.#level(right));
    // Terminal pairs were reduced above, so at least one operand is nonterminal.
    const a = this.#level(left) === level ? this.#nodes[left - 2] : { low: left, high: left };
    const b = this.#level(right) === level ? this.#nodes[right - 2] : { low: right, high: right };
    const low = this.#apply(operation, a.low, b.low); const high = this.#apply(operation, a.high, b.high);
    const result = this.#make(level, low, high);
    if (this.#cache.size >= this.#limits.maxCacheEntries) throw new BudgetExceeded('cache');
    this.#cache.set(key, result); return result;
  }
  not(root: number): number { return this.apply('xor', root, 1); }
  mux(select: number, low: number, high: number): number {
    return this.apply('or', this.apply('and', this.not(select), low), this.apply('and', select, high));
  }
  evaluate(root: number, assignment: Record<string, boolean>): boolean {
    this.#check(root); this.#assignment(assignment);
    while (root >= 2) { const node = this.#nodes[root - 2]; root = assignment[this.#order[node.level]] ? node.high : node.low; }
    return root === 1;
  }
  #assignment(assignment: Record<string, boolean>): void {
    if (!assignment || typeof assignment !== 'object' || Object.keys(assignment).length !== this.#order.length || this.#order.some(name => !Object.hasOwn(assignment, name) || typeof assignment[name] !== 'boolean')) throw new Error('Assignment must contain exactly the ordered Boolean variables');
  }
  witness(root: number): Record<string, boolean> | null {
    this.#check(root); if (root === 0) return null;
    const assignment = Object.fromEntries(this.#order.map(name => [name, false]));
    while (root >= 2) {
      const node = this.#nodes[root - 2];
      if (node.low !== 0) root = node.low;
      else { assignment[this.#order[node.level]] = true; root = node.high; }
    }
    return assignment;
  }
  reachable(roots: number[]): Node[] {
    const visited = new Set<number>();
    const visit = (id: number) => { this.#check(id); if (id < 2 || visited.has(id)) return; visited.add(id); const n = this.#nodes[id - 2]; visit(n.low); visit(n.high); };
    roots.forEach(visit); return [...visited].sort((a, b) => a - b).map(id => ({ ...this.#nodes[id - 2] }));
  }
}
