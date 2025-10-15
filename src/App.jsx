import React, { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';
import dayjs from 'dayjs';
import { CSVLink } from 'react-csv';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const APPS = ['Todos','iFood','Mais Delivery','Aiqfome','Uai Rango','Whatsapp','Outro'];
const PAYMENTS = ['Todos','Dinheiro','Cartão','PIX','Transferência','Outro'];

export default function App(){
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sales, setSales] = useState([]);

  // auth
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  // sale form
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState(APPS[1]);
  const [payment, setPayment] = useState(PAYMENTS[1]);
  const [saleDate, setSaleDate] = useState(dayjs().format('YYYY-MM-DD'));

  // filters
  const [filterApp, setFilterApp] = useState('Todos');
  const [filterPayment, setFilterPayment] = useState('Todos');
  const [dateFrom, setDateFrom] = useState(dayjs().startOf('month').format('YYYY-MM-DD'));
  const [dateTo, setDateTo] = useState(dayjs().endOf('month').format('YYYY-MM-DD'));

  useEffect(()=>{
    supabase.auth.getUser().then(({data}) => { setUser(data?.user ?? null); setLoading(false); });
    const { data: sub } = supabase.auth.onAuthStateChange((_, session)=> setUser(session?.user ?? null));
    return ()=> sub?.subscription?.unsubscribe?.();
  },[]);

  useEffect(()=>{ if(user) fetchSales(); }, [user]);

  async function signIn(){
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) alert(error.message);
    setLoading(false);
  }

  async function signOut(){ await supabase.auth.signOut(); setSales([]); }

  async function createSale(e){
    e?.preventDefault();
    const val = parseFloat((amount || '').toString().replace(',', '.'));
    if(!val || val <= 0) return alert('Informe um valor válido');
    const payload = { amount: val, source, payment_method: payment, sale_date: dayjs(saleDate).toISOString() };
    const { error } = await supabase.from('sales').insert([payload]);
    if(error) return alert(error.message);
    setAmount('');
    fetchSales();
  }

  async function fetchSales(){
    setLoading(true);
    let q = supabase.from('sales').select('*').order('sale_date',{ascending:false});
    if(dateFrom) q = q.gte('sale_date', dayjs(dateFrom).startOf('day').toISOString());
    if(dateTo) q = q.lte('sale_date', dayjs(dateTo).endOf('day').toISOString());
    const { data, error } = await q;
    if(error) { alert(error.message); setSales([]);} else setSales(data ?? []);
    setLoading(false);
  }

  const filtered = sales.filter(s => (filterApp === 'Todos' || s.source === filterApp) && (filterPayment === 'Todos' || s.payment_method === filterPayment));

  const totalAll = sales.reduce((a,b)=>a+parseFloat(b.amount),0).toFixed(2);
  const totalFiltered = filtered.reduce((a,b)=>a+parseFloat(b.amount),0).toFixed(2);

  return (
    <div className="container">
      <div className="header">
        <div className="brand">
          <div className="logo">MA</div>
          <div>
            <div className="title">Sistema Mega Açaí</div>
            <div style={{fontSize:12,color:'var(--muted)'}}>Controle de vendas — fácil e seguro</div>
          </div>
        </div>
        <div>
          {user ? (
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <div style={{fontSize:13,color:'var(--muted)'}}>{user.email}</div>
              <button className="ghost" onClick={signOut}>Sair</button>
            </div>
          ) : null}
        </div>
      </div>

      {!user ? (
        <div className="card">
          <h3>Entrar</h3>
          <div className="form-row">
            <input placeholder="Email" value={email} onChange={e=>setEmail(e.target.value)} />
            <input placeholder="Senha" type="password" value={password} onChange={e=>setPassword(e.target.value)} />
            <button onClick={signIn}>Entrar</button>
          </div>
          <p style={{fontSize:13,color:'var(--muted)',marginTop:8}}>Obs: O cadastro não é público. Crie usuários manualmente no painel do Supabase (Auth → Users).</p>
        </div>
      ) : (
        <>
          <div className="card">
            <h3>Registrar venda</h3>
            <form onSubmit={createSale} className="form-row">
              <input placeholder="Valor (ex: 12.50)" value={amount} onChange={e=>setAmount(e.target.value)} />
              <select value={source} onChange={e=>setSource(e.target.value)}>
                {APPS.slice(1).map(a=> <option key={a} value={a}>{a}</option>)}
              </select>
              <select value={payment} onChange={e=>setPayment(e.target.value)}>
                {PAYMENTS.slice(1).map(p=> <option key={p} value={p}>{p}</option>)}
              </select>
              <input type="date" value={saleDate} onChange={e=>setSaleDate(e.target.value)} />
              <button type="submit">Salvar</button>
            </form>
          </div>

          <div className="card">
            <h3>Filtros</h3>
            <div className="form-row">
              <label className="filter-pill">App:
                <select value={filterApp} onChange={e=>setFilterApp(e.target.value)} style={{marginLeft:8}}>
                  {APPS.map(a=> <option key={a} value={a}>{a}</option>)}
                </select>
              </label>

              <label className="filter-pill">Pagamento:
                <select value={filterPayment} onChange={e=>setFilterPayment(e.target.value)} style={{marginLeft:8}}>
                  {PAYMENTS.map(p=> <option key={p} value={p}>{p}</option>)}
                </select>
              </label>

              <label className="filter-pill">De:
                <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{marginLeft:8}} />
              </label>

              <label className="filter-pill">Até:
                <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{marginLeft:8}} />
              </label>

              <button onClick={fetchSales}>Aplicar</button>
              <CSVLink data={filtered} filename={`vendas_${dayjs().format('YYYYMMDD')}.csv`} style={{marginLeft:8}}>Exportar CSV (filtrado)</CSVLink>
            </div>

            <div style={{display:'flex',justifyContent:'space-between',marginTop:12,alignItems:'center'}}>
              <div>
                <div style={{fontSize:13,color:'var(--muted)'}}>Total geral (no período selecionado entre datas):</div>
                <div className="total">R$ {totalAll}</div>
              </div>
              <div style={{textAlign:'right'}}>
                <div style={{fontSize:13,color:'var(--muted)'}}>Total (após filtros):</div>
                <div className="total">R$ {totalFiltered}</div>
              </div>
            </div>

          </div>

          <div className="card">
            <h3>Vendas</h3>
            <table className="table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Valor</th>
                  <th>App</th>
                  <th>Pagamento</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(s => (
                  <tr key={s.id}>
                    <td>{dayjs(s.sale_date).format('DD/MM/YYYY HH:mm')}</td>
                    <td>R$ {parseFloat(s.amount).toFixed(2)}</td>
                    <td>{s.source}</td>
                    <td>{s.payment_method}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filtered.length === 0 && <div style={{padding:12,color:'var(--muted)'}}>Nenhuma venda encontrada para os filtros selecionados.</div>}
          </div>
        </>
      )}

      {loading && <div className="card">Carregando...</div>}
    </div>
  );
}
