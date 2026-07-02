/**
 * GET /api/transactions
 * 查询已收集的交易数据（需要认证令牌）
 *
 * 查询参数:
 *   - token: 管理令牌（必需）
 *   - wallet: 按钱包地址过滤（可选）
 *   - status: 按状态过滤（可选: success / pending）
 *   - page: 页码，默认1（可选）
 *   - limit: 每页数量，默认50（可选）
 *   - stats: 设为 "true" 仅返回统计数据（可选）
 */

const { kv } = require('@vercel/kv');

// 从环境变量读取管理令牌
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'admin123456';

// 允许的来源域名
const ALLOWED_ORIGINS = [
  'https://你的域名.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
];

module.exports = async function handler(req, res) {
  // CORS 处理
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: '仅支持 GET 请求' });
  }

  // 验证令牌
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token || token !== ADMIN_TOKEN) {
    return res.status(401).json({
      success: false,
      error: '认证失败，请提供有效的管理令牌',
    });
  }

  try {
    // 如果请求统计数据
    if (req.query.stats === 'true') {
      const totalTxs = (await kv.lrange('transactions:list', 0, -1)).length;
      const uniqueWallets = await kv.scard('wallets:unique');

      return res.status(200).json({
        success: true,
        stats: {
          total_transactions: totalTxs,
          unique_wallets: uniqueWallets,
        },
      });
    }

    // 分页参数
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const start = (page - 1) * limit;
    const end = start + limit - 1;

    let transactionIds;

    // 如果指定了钱包地址，只查该钱包的交易
    if (req.query.wallet) {
      transactionIds = await kv.lrange(`wallet:${req.query.wallet}:txs`, 0, -1);
    } else {
      transactionIds = await kv.lrange('transactions:list', 0, -1);
    }

    if (!transactionIds || transactionIds.length === 0) {
      return res.status(200).json({
        success: true,
        data: [],
        pagination: {
          page,
          limit,
          total: 0,
          total_pages: 0,
        },
      });
    }

    // 获取每条交易详情
    const allTransactions = [];
    for (const id of transactionIds) {
      const raw = await kv.get(`tx:${id}`);
      if (raw) {
        try {
          const record = typeof raw === 'string' ? JSON.parse(raw) : raw;
          allTransactions.push(record);
        } catch (e) {
          console.error(`解析记录失败: ${id}`);
        }
      }
    }

    // 按状态过滤
    let filtered = allTransactions;
    if (req.query.status) {
      filtered = allTransactions.filter((tx) => tx.status === req.query.status);
    }

    // 按创建时间降序排列
    filtered.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    // 分页
    const paginated = filtered.slice(start, end + 1);
    const total = filtered.length;
    const totalPages = Math.ceil(total / limit);

    return res.status(200).json({
      success: true,
      data: paginated,
      pagination: {
        page,
        limit,
        total,
        total_pages: totalPages,
      },
    });
  } catch (error) {
    console.error('查询交易数据失败:', error);

    return res.status(500).json({
      success: false,
      error: '服务器内部错误，请稍后重试',
    });
  }
};
