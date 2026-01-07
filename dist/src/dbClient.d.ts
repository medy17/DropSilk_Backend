import { QueryResult, QueryResultRow } from "pg";
export declare function initializeDatabase(): Promise<void>;
export declare function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>>;
export declare function isDatabaseInitialized(): boolean;
//# sourceMappingURL=dbClient.d.ts.map