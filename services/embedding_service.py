"""
向量嵌入服务 - 生成文本向量用于语义搜索
"""

import os
import json
import numpy as np
from typing import List, Dict, Any, Optional
from openai import OpenAI
from loguru import logger


class EmbeddingService:
    """向量嵌入服务"""

    def __init__(self):
        # 统一使用LLM服务的API配置，避免配置不一致
        self.api_key = os.getenv('LLM_API_KEY')
        self.base_url = os.getenv('LLM_BASE_URL', 'https://api.minimaxi.chat/v1')
        self.model_name = os.getenv('EMBEDDING_MODEL', 'BAAI/bge-large-zh-v1.5')

        self.client = OpenAI(
            api_key=self.api_key,
            base_url=self.base_url
        )

        self.data_dir = os.path.join(os.path.dirname(__file__), '..', 'data')
        os.makedirs(self.data_dir, exist_ok=True)

        self.index_file = os.path.join(self.data_dir, 'faiss_index.bin')
        self.mapping_file = os.path.join(self.data_dir, 'vector_mapping.json')
        self.meta_file = os.path.join(self.data_dir, 'vector_meta.json')

        self.index = None
        self.memory_mapping = {}  # vector_id -> memory_id
        self.dim = None  # 延迟初始化，首次embed时检测
        self._load_index()

        logger.info(f"Embedding服务初始化完成，索引文件: {self.index_file}")

    def _load_index(self):
        """加载FAISS索引"""
        try:
            import faiss

            # 加载元数据（包含维度信息）
            if os.path.exists(self.meta_file):
                with open(self.meta_file, 'r', encoding='utf-8') as f:
                    meta = json.load(f)
                    self.dim = meta.get('dim')
                    logger.info(f"从元数据加载维度: {self.dim}")

            if os.path.exists(self.index_file) and os.path.exists(self.mapping_file):
                self.index = faiss.read_index(self.index_file)
                with open(self.mapping_file, 'r', encoding='utf-8') as f:
                    self.memory_mapping = json.load(f)
                # 从索引获取实际维度
                if self.dim is None:
                    self.dim = self.index.d
                logger.info(f"已加载FAISS索引，包含 {self.index.ntotal} 个向量，维度: {self.dim}")
            else:
                # 延迟创建索引，等待首次embed时确定维度
                self.index = None
                self.memory_mapping = {}
                logger.info("等待首次embed时创建FAISS索引")
        except Exception as e:
            logger.error(f"加载FAISS索引失败: {e}")
            self.index = None
            self.memory_mapping = {}
            self.dim = None

    def _save_index(self):
        """保存FAISS索引"""
        try:
            import faiss
            if self.index is not None:
                faiss.write_index(self.index, self.index_file)
            with open(self.mapping_file, 'w', encoding='utf-8') as f:
                json.dump(self.memory_mapping, f, ensure_ascii=False)
            # 保存元数据
            if self.dim is not None:
                with open(self.meta_file, 'w', encoding='utf-8') as f:
                    json.dump({'dim': self.dim}, f)
            logger.info(f"索引已保存，共 {len(self.memory_mapping)} 个向量映射")
        except Exception as e:
            logger.error(f"保存索引失败: {e}")

    def embed_text(self, text: str) -> Optional[np.ndarray]:
        """
        生成文本向量

        Args:
            text: 输入文本

        Returns:
            向量 numpy array
        """
        import faiss

        if not text or not text.strip():
            logger.warning("空文本，跳过向量化")
            return None

        try:
            response = self.client.embeddings.create(
                model=self.model_name,
                input=text[:8000]  # 限制长度避免超长文本
            )

            embedding = response.data[0].embedding
            vector = np.array(embedding, dtype=np.float32)

            # 首次embed时检测维度并初始化索引
            if self.dim is None:
                self.dim = vector.shape[0]
                self.index = faiss.IndexFlatIP(self.dim)
                logger.info(f"检测到向量维度: {self.dim}，已创建FAISS索引")
            elif vector.shape[0] != self.dim:
                logger.error(f"向量维度不匹配: 期望{self.dim}, 实际{vector.shape[0]}")
                return None

            # L2归一化（FAISS Inner Product需要）
            faiss.normalize_L2(vector.reshape(1, -1))

            return vector

        except Exception as e:
            logger.error(f"生成向量失败: {e}")
            return None

    def add_memory(self, memory_id: str, text: str) -> bool:
        """
        添加记忆向量到索引

        Args:
            memory_id: 记忆ID
            text: 要向量化的文本（通常用理解结果description或summary）

        Returns:
            是否成功
        """
        try:
            # 检查索引是否初始化
            if self.index is None:
                logger.info("索引尚未初始化，首次添加将自动检测维度")

            vector = self.embed_text(text)
            if vector is None:
                return False

            # 添加到FAISS索引
            self.index.add(vector.reshape(1, -1))

            # 更新映射
            vector_id = self.index.ntotal - 1
            self.memory_mapping[str(vector_id)] = memory_id

            self._save_index()
            logger.info(f"记忆 {memory_id} 已添加到向量索引 (vector_id: {vector_id})")
            return True

        except Exception as e:
            logger.error(f"添加记忆向量失败: {e}")
            return False

    def search(self, query: str, top_k: int = 5, similarity_threshold: float = 0.5) -> List[Dict[str, Any]]:
        """
        搜索最相似的记忆

        Args:
            query: 查询文本
            top_k: 返回数量
            similarity_threshold: 相似度阈值（0-1之间，默认0.5）

        Returns:
            [(memory_id, score, text), ...]
        """
        try:
            # 检查索引状态
            if self.index is None or self.index.ntotal == 0:
                logger.warning("向量索引为空，无法搜索")
                return []

            query_vector = self.embed_text(query)
            if query_vector is None:
                logger.error("查询向量化失败")
                return []

            # 搜索更多结果以便过滤
            search_k = min(top_k * 3, self.index.ntotal)
            distances, indices = self.index.search(query_vector.reshape(1, -1), search_k)

            results = []
            for dist, idx in zip(distances[0], indices[0]):
                if idx < 0:
                    continue
                # FAISS Inner Product返回的是内积值（对于归一化向量等于余弦相似度）
                # 值域为[-1, 1]，过滤低于阈值的
                if dist < similarity_threshold:
                    continue
                memory_id = self.memory_mapping.get(str(int(idx)), None)
                if memory_id:
                    results.append({
                        'memory_id': memory_id,
                        'score': float(dist),
                        'vector_id': int(idx)
                    })

            # 限制返回数量
            results = results[:top_k]
            logger.info(f"向量搜索完成，查询: '{query[:30]}...', 返回 {len(results)} 个结果 (阈值: {similarity_threshold})")
            return results

        except Exception as e:
            logger.error(f"向量搜索失败: {e}")
            return []

    def remove_memory(self, memory_id: str) -> bool:
        """
        删除记忆时移除向量（FAISS不支持单独删除，需要重建索引）

        Args:
            memory_id: 记忆ID

        Returns:
            是否成功
        """
        try:
            # 找出要删除的vector_id
            vector_ids_to_remove = [vid for vid, mid in self.memory_mapping.items() if mid == memory_id]

            if not vector_ids_to_remove:
                return True  # 没有找到，不需要删除

            # 注意：FAISS IndexFlatIP不支持删除操作，这里标记一下
            # 实际删除需要重建索引，简单起见这里先标记删除
            for vid in vector_ids_to_remove:
                del self.memory_mapping[vid]

            # 如果有删除标记，重建索引（简化处理）
            # 这里暂时不做实际删除，下次重建索引时清理
            self._save_index()
            logger.info(f"记忆 {memory_id} 已标记删除")
            return True

        except Exception as e:
            logger.error(f"删除记忆向量失败: {e}")
            return False

    def rebuild_index(self, memories: Dict[str, Dict]) -> bool:
        """
        重建整个索引（用于清理已删除的向量）

        Args:
            memories: memory_id -> memory对象

        Returns:
            是否成功
        """
        try:
            import faiss

            # 重建映射（只保留仍然存在的记忆）
            new_mapping = {}
            vectors = []

            for memory_id, memory in memories.items():
                # 获取要向量化的文本
                understanding = memory.get('understanding', {})
                text = understanding.get('description', '') or understanding.get('summary', '') or memory.get('content', '')

                if not text:
                    continue

                vector = self.embed_text(text)
                if vector is not None:
                    vectors.append(vector)
                    new_mapping[str(len(vectors) - 1)] = memory_id

            if not vectors:
                if self.dim:
                    self.index = faiss.IndexFlatIP(self.dim)
                else:
                    self.index = None
                self.memory_mapping = {}
                self._save_index()
                logger.info("索引重建完成，向量为空")
                return True

            # 创建新索引
            vectors_array = np.vstack(vectors).astype(np.float32)

            # 使用第一个向量的维度
            if self.dim is None and len(vectors) > 0:
                self.dim = vectors[0].shape[0]

            new_index = faiss.IndexFlatIP(self.dim)
            new_index.add(vectors_array)

            self.index = new_index
            self.memory_mapping = new_mapping
            self._save_index()

            logger.info(f"索引重建完成，共 {len(vectors)} 个向量")
            return True

        except Exception as e:
            logger.error(f"重建索引失败: {e}")
            return False
