# types/

`index.d.ts` is the `$.state` contract of the hooks module: each value the module keeps in the session's plugin state, declared under the mod's name (`override`, `handedOff`, `t3Steered`, `noticed`, `panel`). `claude plugin validate` holds every `$.state` key the module names to it, and a value whose shape changes carries a `shape` tag in its atom so an older stored value is declined rather than misread.

The file may contain types and the `declare module 'claude-code'` block only; a bare `export {}` is refused.
