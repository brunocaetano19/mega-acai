const API = 'https://sistema-mega-acai.onrender.com'; // ajuste se necessário
let token = null;
let cart = [];

// Função helper para selecionar elementos
function $(id) { return document.getElementById(id); }

// Função para fetch com headers e token
async function fetchJSON(url, opts = {}) {
    opts.headers = opts.headers || {};
    opts.headers['Content-Type'] = 'application/json';
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;

    const res = await fetch(API + url, opts);
    if (res.status === 401) { 
        alert('Sessão inválida. Faça login novamente.'); 
        location.reload(); 
        return; 
    }
    return res.json();
}

// Inicializar selects
async function init() {
    const [products, addons, apps, payments] = await Promise.all([
        fetchJSON('/products'),
        fetchJSON('/add_ons'),
        fetchJSON('/apps'),
        fetchJSON('/payment_methods')
    ]);
    populateSelect('productSelect', products, 'id', 'name');
    populateSelect('addonSelect', addons, 'id', 'name');
    populateSelect('appSelect', apps, 'id', 'name');
    populateSelect('paymentSelect', payments, 'id', 'name');
}

// Popular select
function populateSelect(id, items, valueField, textField) {
    const sel = $(id);
    sel.innerHTML = '';
    items.forEach(it => {
        const o = document.createElement('option');
        o.value = it[valueField];
        o.textContent = it[textField] + (it.price ? ` - R$${(it.price||0).toFixed(2)}` : '');
        sel.appendChild(o);
    });
}

// Navegação entre seções
document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const target = btn.dataset.target;
        document.querySelectorAll('.section, #dashboardSection').forEach(s => s.classList.add('hidden'));
        $(target).classList.remove('hidden');
    });
});

// Logout
$('#logoutBtn')?.addEventListener('click', () => {
    token = null;
    $('#dashboardSection').classList.add('hidden');
    $('#loginSection').classList.remove('hidden');
});

// Login
$('#btnLogin').addEventListener('click', async () => {
    const email = $('#email').value.trim();
    const password = $('#password').value.trim();
    const res = await fetchJSON('/auth/login', { method:'POST', body: JSON.stringify({ email, password }) });
    
    if(res.token){
        token = res.token;
        $('#loginSection').classList.add('hidden');
        $('#dashboardSection').classList.remove('hidden');
        init();
    } else {
        $('#loginMsg').textContent = res.error || 'Erro ao entrar';
    }
});

// Adicionar produto
$('#addProduct').addEventListener('click', async () => {
    const productId = parseInt($('#productSelect').value);
    const qty = parseInt($('#productQty').value) || 1;
    const prod = (await fetchJSON('/products')).find(p => p.id === productId);
    cart.push({ type:'product', product_id: productId, name: prod.name, qty, price_unit: prod.price, addons: [] });
    renderCart();
});

// Adicionar adicional
$('#addAddon').addEventListener('click', async () => {
    const addonId = parseInt($('#addonSelect').value);
    const qty = parseInt($('#addonQty').value) || 1;
    const addon = (await fetchJSON('/add_ons')).find(a => a.id === addonId);

    if(cart.length > 0 && cart[cart.length-1].type === 'product') {
        cart[cart.length-1].addons.push({ addon_id: addonId, name: addon.name, qty, price_unit: addon.price });
    } else {
        cart.push({ type:'addon', addon_id: addonId, name: addon.name, qty, price_unit: addon.price });
    }
    renderCart();
});

// Renderizar carrinho
function renderCart() {
    const list = $('#cartList');
    list.innerHTML = '';
    let total = 0;

    cart.forEach(c => {
        const li = document.createElement('li');
        if(c.type === 'product') {
            const sub = c.price_unit * c.qty;
            total += sub;
            li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;

            if(c.addons.length > 0) {
                const ul = document.createElement('ul');
                c.addons.forEach(a => {
                    const subAddon = a.price_unit * a.qty;
                    total += subAddon;
                    const li2 = document.createElement('li');
                    li2.textContent = `+ ${a.name} x${a.qty} - R$${subAddon.toFixed(2)}`;
                    ul.appendChild(li2);
                });
                li.appendChild(ul);
            }
        } else {
            const sub = c.price_unit * c.qty;
            total += sub;
            li.textContent = `${c.name} x${c.qty} - R$${sub.toFixed(2)}`;
        }
        list.appendChild(li);
    });

    total += parseFloat($('#deliveryFee').value) || 0;
    $('#totalValue').textContent = total.toFixed(2);
}

// Finalizar venda
$('#finalize').addEventListener('click', async () => {
    if(cart.length === 0){ alert('Carrinho vazio'); return; }

    const app_id = parseInt($('#appSelect').value) || null;
    const payment_method_id = parseInt($('#paymentSelect').value) || null;
    const delivery_fee = parseFloat($('#deliveryFee').value) || 0;

    const itemsPayload = cart.map(c => {
        if(c.type === 'product'){
            return {
                product_id: c.product_id,
                qty: c.qty,
                price_unit: c.price_unit,
                addons: c.addons.map(a => ({ addon_id: a.addon_id, qty: a.qty, price_unit: a.price_unit }))
            };
        } else {
            return { product_id: null, qty: c.qty, price_unit: c.price_unit, addons: [] };
        }
    });

    const res = await fetchJSON('/sales', { method:'POST', body: JSON.stringify({ items: itemsPayload, delivery_fee, app_id, payment_method_id }) });

    if(res && res.success){
        alert(`Venda registrada — Total R$ ${res.total.toFixed(2)}`);
        cart = [];
        renderCart();
    } else {
        alert('Erro ao registrar venda: ' + (res.error || JSON.stringify(res)));
    }
});

// Relatórios
$('#loadSales').addEventListener('click', async () => {
    const from = $('#fromDate').value || null;
    const to = $('#toDate').value || null;
    const rows = await fetchJSON(`/sales?from=${from||''}&to=${to||''}`);
    const out = $('#reportsOutput');
    out.innerHTML = '<h4>Vendas</h4>';
    rows.forEach(r => {
        const d = document.createElement('div');
        d.textContent = `${r.date_time} - R$${r.total.toFixed(2)} - ${r.app_name||''} - ${r.payment_name||''}`;
        out.appendChild(d);
    });
});

$('#loadTopProducts').addEventListener('click', async () => {
    const from = $('#fromDate').value || null;
    const to = $('#toDate').value || null;
    const rows = await fetchJSON(`/reports/top-products?from=${from||''}&to=${to||''}`);
    const out = $('#reportsOutput');
    out.innerHTML = '<h4>Top Copos</h4>';
    rows.forEach(r => {
        const d = document.createElement('div');
        d.textContent = `${r.name} — ${r.qtd} vendidos`;
        out.appendChild(d);
    });
});

$('#loadTopAddons').addEventListener('click', async () => {
    const from = $('#fromDate').value || null;
    const to = $('#toDate').value || null;
    const rows = await fetchJSON(`/reports/top-addons?from=${from||''}&to=${to||''}`);
    const out = $('#reportsOutput');
    out.innerHTML = '<h4>Top Adicionais</h4>';
    rows.forEach(r => {
        const d = document.createElement('div');
        d.textContent = `${r.name} — ${r.qtd} vendidos`;
        out.appendChild(d);
    });
});

// Estoque
$('#stockSubmit').addEventListener('click', async () => {
    const produto = $('#stockProduto').value.trim();
    const tipo = $('#stockTipo').value;
    const quantidade = parseFloat($('#stockQuant').value) || 0;
    const valor_unitario = parseFloat($('#stockValor').value) || null;
    const motivo = $('#stockMotivo').value || '';

    const res = await fetchJSON('/stock/movements', { method:'POST', body: JSON.stringify({ produto, tipo, quantidade, valor_unitario, motivo }) });
    if(res && res.success){
        alert('Movimento registrado');
        $('#stockProduto').value=''; 
        $('#stockQuant').value='1'; 
        $('#stockValor').value=''; 
        $('#stockMotivo').value='';
    } else {
        alert('Erro: ' + JSON.stringify(res));
    }
});

$('#loadStock').addEventListener('click', async () => {
    const rows = await fetchJSON('/stock');
    const out = $('#stockOutput');
    out.innerHTML = '<h4>Saldo</h4>';
    rows.forEach(r => {
        const d = document.createElement('div');
        d.textContent = `${r.produto} — Entrada: ${r.entrada} Saída: ${r.saida} Saldo: ${r.saldo}`;
        out.appendChild(d);
    });
});
