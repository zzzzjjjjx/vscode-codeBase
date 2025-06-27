// code-chunker 模块类型声明

export interface FileProgressSummary {
  file: string;
  language: string;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
  successRate: number;
}

export interface FileProgress {
  totalFiles: number;
  completedFiles: number;
  processingFiles: number;
  failedFiles: number;
  pendingFiles: number;
  progressPercentage: number;
}

export interface ChunkProgress {
  pendingChunks: number;
  processingChunks: number;
  completedChunks: number;
  failedChunks: number;
  totalChunks: number;
  successRate: number;
}

export interface CacheInfo {
  totalVectors: number;
  cacheSize: number;
  lastUpdate?: string;
}

export interface SearchResult {
  filePath?: string;
  fileName?: string;
  content?: string;
  score: number;
}

export interface ChunkerInstance {
  progressTracker?: {
    getProgress(): {
      percentage: number;
      processed: number;
      total: number;
      status: string;
      currentFile?: string;
    };
    getFileProgress(): FileProgress;
    getOverallProgress(): ChunkProgress;
    getFileProgressSummary(): FileProgressSummary[];
  };
  vectorManager?: {
    initialize(): Promise<void>;
    getCacheInfo(): Promise<CacheInfo>;
    clearCache?(): Promise<void>;
    vectorDB?: {
      implementation?: {
        dropCollection(databaseName: string, collectionName: string): Promise<any>;
        createCollection(databaseName: string, collectionName: string, params?: any): Promise<any>;
        listCollections(databaseName: string): Promise<any>;
      };
    };
  };
  search?(query: string, options?: { topK?: number }): Promise<SearchResult[]>;
  processWorkspace(
    userId: string,
    deviceId: string,
    workspacePath: string,
    token: string,
    ignorePatterns?: string[]
  ): Promise<boolean>;
}

export interface CodeChunkerModule {
  processWorkspace(
    userId: string,
    deviceId: string,
    workspacePath: string,
    token: string,
    ignorePatterns?: string[]
  ): Promise<boolean>;

  getChunkerInstance(
    userId: string,
    deviceId: string,
    workspacePath: string,
    token: string
  ): ChunkerInstance;

  chunkerInstances: Map<string, ChunkerInstance>;
  
  CodeChunker: new (config: any) => ChunkerInstance;
}

// 为 require 函数添加类型声明
declare const require: (id: string) => any; 