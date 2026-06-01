# AgentFlow

## TypeScript 哲学

本项目追求**现代、地道、编译器优先**的 TypeScript 代码。核心原则：

### 类型系统即文档，编译器即护栏

- **零 `any`**：用 `unknown` 代替，迫使调用方做类型收窄。
- **零非空断言 `!`**：用类型守卫（`if (x !== undefined)`）或 discriminated union 代替。
- **显式优于隐式**：函数参数和返回值必须标注类型，不要依赖类型推断来"省事"。

### 优先使用 TypeScript 的表达力

- **Discriminated Union > 可选属性堆叠**：用 `kind` / `type` 字段区分状态，而非 `a?: T; b?: U`。
- **`as const` + `satisfies`**：定义常量对象时，用 `as const satisfies SomeType` 同时获得字面量类型和类型校验。
- **`Record` / `Map` > 空接口**：不要写 `interface Foo { [key: string]: any }`，用 `Record<string, unknown>` 或泛型 `Map<K, V>`。
- **Template Literal Types**：用模板字面量类型表达字符串模式（如 `${string}.${string}`）。

### 模块与导入

- **`verbatimModuleSyntax: true`**：类型导入必须用 `import type`，值导入不要带 `type`。
- **barrel export 按需使用**：公共 API 用 `index.ts` 导出，内部模块直接引用路径。

### 错误处理

- **Result 模式**：可预期的错误用 `Result<T, E>` 返回，不要 throw。
- **`never` 穷尽检查**：switch/if 分支覆盖所有情况后，default 分支赋值给 `never` 类型的变量来保证编译期穷尽性。

### 命名与结构

- 变量、函数：camelCase
- 类型、接口、泛型参数：PascalCase
- 常量、枚举值：UPPER_SNAKE_CASE
- 文件名：kebab-case
- 每个文件一个主要导出，文件名即模块名

## 项目结构

```
src/
  index.ts          # 入口
  ...
```

## 开发命令

- `npm run dev` — tsx 开发运行
- `npm run build` — tsdown 打包（Rolldown）
- `npm run check` — 仅类型检查
