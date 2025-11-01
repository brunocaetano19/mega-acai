// === CONFIGURAÇÃO ===
const API = ''; // mesmo domínio (Render)
let token = null;
let cart = [];

// === FUNÇÕES GERAIS ===
function $(id) { return document.getElementById(id); }

function hideAllSections() {
  document.querySelectorAll('.section').forEach(s => s.classList.add('hidden'));
}

function showSection(sectionId) {
  hideAllSections();
  $(sectionId).classList.remove('hidden');
}

function showMenu(show) {
  if (show) $('menu').classList.remove('hidden');
  else $('menu').classList.add('hidden');
}

async function fetchJSON(endpoint, options = {}) {
  options.headers = options.headers || {};
  options.headers['Content-Type'] = 'application/json';
  if (token) options.headers['Authorization'] = 'Bearer ' + token;

  try {
    const res = await fetch(API + endpoint, options);
    if (!res.ok) throw new Error(`Erro ${res.status}`);
    return await res.json();
  } catch (err) {
    console.error('Erro ao buscar:', err);
    alert('Falha na comunicação com o servidor.');
    return null;
  }
}

// === LOGIN ===
$('btnLogin').addEventListener('click', async () => {
  const email = $('email').value.trim();
  const password = $('password').value.trim();
  if (!email || !password) {
    $('loginMsg').textContent = 'Preencha todos os campos.';
    return;
  }

  $('loginMsg').textContent = 'Entrando...';
  const res = await fetchJSON('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

  if (res && res.token) {
    token = res.token;
    $('userArea').textContent = `${res.user.name} (${res.user.email})`;

    // Mostra menu e PDV por padrão
    showMenu(true);
    $('loginSection').classList.add('hidden');
    showSection('pdvSection');

    await init();
  } else {
    $('loginMsg').textContent = res?.error || 'Usuário ou senha incorretos.';
  }
});

$('btnLogout').addEventListener('click', () => {
  token = null;
  showMenu(false);
  hideAllSections();
  $('loginSection').classList.remove('hidden');
});

// === MENU ===
$('btnVenda').addEventListener('click', () => showSection('pdvSection'));
$('btnRelatorios').addEventListener('click', () => showSection('reportsSection'));
$('btnEstoque').addEventListener('click', () => showSection('stockSection'));

// === INICIALIZAÇÃO ===
async function init() {
  const [products, addons, apps, payments] = await Promise.all([
    fetchJSON('/products'),
    fetchJSON('/add_ons'),
    fetchJSON('/apps'),
    fetchJSON('/payment_methods')
  ]);

  populateSelect('productSelect', products);
  populateSelect('addonSelect', addons);
  populateSelect('appSelect', apps);
  populateSelect('paymentSelect', payments);
}

function populateSelect(id, items) {
  const sel = $(id);
  sel.innerHTML = '';
  if (!items) return;
  items.forEach(i => {
    const opt = document.createElement('option');
    opt.value = i.id;
    opt.textContent = i.name + (i.price ? ` - R$${i.price.toFixed(2)}` : '');
    sel.appendChild(opt);
  });
}

// === CARRINHO ===
$('addProduct').addEventListener('click', async () => {
  const id = parseInt($('productSelect').value);
  const qty = parseInt($('productQty').value);
  const products = await fetchJSON('/products');
  const prod = products.find(p => p.id === id);
  if (!prod) return alert('Produto inválido');

  cart.push({ type: 'product', name: prod.name, price_unit: prod.price, qty, addons: [] });
  renderCart();
});

$('addAddon').addEventListener('click', async () => {
  const id = parseInt($('addonSelect').value);
  const qty = parseInt($('addonQty').value);
  const addons = await fetchJSON('/add_ons');
  const add = addons.find(a => a.id === id);
  if (!add) return alert('Adicional inválido');

  if (cart.length > 0) {
    cart[cart.length - 1].addons.push({ name: add.name, price_unit: add.price, qty });
  }
  renderCart();
});

function renderCart() {
  const list = $('cartList');
  list.innerHTML = '';
  let total = 0;
  cart.forEach(c => {
    const item = document.createElement('li');
    let subtotal = c.qty * c.price_unit;
    item.textContent = `${c.name} x${c.qty} - R$${subtotal.toFixed(2)}`;
    total += subtotal;

    if (c.addons?.length) {
      const ul = document.createElement('ul');
      c.addons.forEach(a => {
        const li2 = document.createElement('li');
        const sub = a.qty * a.price_unit;
        li2.textContent = `+ ${a.name} x${a.qty} - R$${sub.toFixed(2)}`;
        ul.appendChild(li2);
        total += sub;
      });
      item.appendChild(ul);
    }
    list.appendChild(item);
  });

  const delivery = parseFloat($('deliveryFee').value) || 0;
  total += delivery;
  $('totalValue').textContent = total.toFixed(2);
}

// === FINALIZAR VENDA ===
$('finalize').addEventListener('click', async () => {
  if (cart.length === 0) return alert('Carrinho vazio.');

  const payload = {
    items: cart,
    app_id: parseInt($('appSelect').value),
    payment_method_id: parseInt($('paymentSelect').value),
    delivery_fee: parseFloat($('deliveryFee').value) || 0
  };
  const res = await fetchJSON('/sales', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

  if (res && res.success) {
    alert('Venda registrada com sucesso!');
    cart = [];
    renderCart();
  } else alert('Erro ao registrar venda.');
});

// === RELATÓRIOS ===
$('loadSales').addEventListener('click', async () => {
  const from = $('fromDate').value, to = $('toDate').value;
  const data = await fetchJSON(`/sales?from=${from}&to=${to}`);
  const out = $('reportsOutput');
  out.innerHTML = '<h4>Vendas</h4>';
  data?.forEach(r => {
    const div = document.createElement('div');
    div.textContent = `${r.date_time} - R$${r.total.toFixed(2)} - ${r.app_name || ''} - ${r.payment_name || ''}`;
    out.appendChild(div);
  });
});

$('loadTopProducts').addEventListener('click', async () => {
  const from = $('fromDate').value, to = $('toDate').value;
  const data = await fetchJSON(`/reports/top-products?from=${from}&to=${to}`);
  const out = $('reportsOutput');
  out.innerHTML = '<h4>Top Copos</h4>';
  data?.forEach(r => {
    const d = document.createElement('div');
    d.textContent = `${r.name} — ${r.qtd} vendidos`;
    out.appendChild(d);
  });
});

$('loadTopAddons').addEventListener('click', async () => {
  const from = $('fromDate').value, to = $('toDate').value;
  const data = await fetchJSON(`/reports/top-addons?from=${from}&to=${to}`);
  const out = $('reportsOutput');
  out.innerHTML = '<h4>Top Adicionais</h4>';
  data?.forEach(r => {
    const d = document.createElement('div');
    d.textContent = `${r.name} — ${r.qtd} vendidos`;
    out.appendChild(d);
  });
});

// === ESTOQUE ===
$('stockSubmit').addEventListener('click', async () => {
  const produto = $('stockProduto').value.trim();
  const tipo = $('stockTipo').value;
  const quantidade = parseFloat($('stockQuant').value);
  const valor = parseFloat($('stockValor').value) || null;
  const motivo = $('stockMotivo').value;

  const res = await fetchJSON('/stock/movements', {
    method: 'POST',
    body: JSON.stringify({ produto, tipo, quantidade, valor_unitario: valor, motivo })
  });

  if (res && res.success) {
    alert('Movimento registrado!');
    $('stockProduto').value = '';
  } else alert('Erro ao registrar movimento.');
});

$('loadStock').addEventListener('click', async () => {
  const data = await fetchJSON('/stock');
  const out = $('stockOutput');
  out.innerHTML = '<h4>Saldo de Estoque</h4>';
  data?.forEach(r => {
    const d = document.createElement('div');
    d.textContent = `${r.produto} — Entrada: ${r.entrada} | Saída: ${r.saida} | Saldo: ${r.saldo}`;
    out.appendChild(d);
  });
});
