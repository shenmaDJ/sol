/**
 * POST /api/collect
 * 接收并存储来自前端的交易数据（钱包地址、交易ID等）
 */

const { kv } = require('@vercel/kv');

// 允许的来源域名（CORS配置）
const ALLOWED_ORIGINS = [
  'https://你的域名.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://127.0.0.1:3000',
];

// 生成唯一ID
function generateId() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${random}`;
}

// 验证交易数据
function validateTransactionData(data) {
  const errors = [];

  if (!data.wallet_address || typeof data.wallet_address !== 'string') {
    errors.push('缺少钱包地址');
  } else if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(data.wallet_address)) {
    errors.push('钱包地址格式不正确');
  }

  if (!data.transaction_id || typeof data.transaction_id !== 'string') {
    errors.push('缺少交易ID');
  }

  return errors;
}

module.exports = async function handler(req, res) {
  // CORS 处理
  const origin = req.headers.origin || '';
  if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }

  // OPTIONS 预检请求
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // 只接受 POST 请求
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: '仅支持 POST 请求',
    });
  }

  try {
    const data = req.body;

    // 验证数据
    const validationErrors = validateTransactionData(data);
    if (validationErrors.length > 0) {
      return res.status(400).json({
        success: false,
        error: '数据验证失败',
        details: validationErrors,
      });
    }

    // 构建存储记录
    const record = {
      id: generateId(),
      wallet_address: data.wallet_address,
      transaction_id: data.transaction_id,
      token_type: data.token_type || 'USDT',
      sol_balance: data.sol_balance ?? null,
      usdt_balance: data.usdt_balance ?? null,
      amount: data.amount || null,
      status: data.status || 'pending',
      location: data.location || '',
      agent_code: data.agent_code || '',
      ip_address:
        data.ip_address ||
        req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
        req.headers['x-real-ip'] ||
        req.socket.remoteAddress ||
        '',
      user_agent: req.headers['user-agent'] || '',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // 存入 Vercel KV
    const recordKey = `tx:${record.id}`;
    await kv.set(recordKey, JSON.stringify(record));

    // 将ID加入交易列表（按时间倒序，最新的在最前面）
    await kv.lpush('transactions:list', record.id);

    // 将钱包地址加入去重集合（用于统计独立用户数）
    await kv.sadd('wallets:unique', data.wallet_address);

    // 同时按钱包地址分组存储（方便按地址查询）
    await kv.lpush(`wallet:${data.wallet_address}:txs`, record.id);

    console.log(`✅ 交易记录已保存: ${record.id} | 钱包: ${data.wallet_address.slice(0, 8)}...`);

    return res.status(200).json({
      success: true,
      message: '交易数据已成功保存',
      record_id: record.id,
    });
  } catch (error) {
    console.error('保存交易数据失败:', error);

    return res.status(500).json({
      success: false,
      error: '服务器内部错误，请稍后重试',
    });
  }
};
