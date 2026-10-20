import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext'
import Layout from './components/Layout'
import RotaProtegida from './components/RotaProtegida'
import Carregando from './components/Carregando'
import Entrar from './pages/Entrar'
import Cadastro from './pages/Cadastro'
import EsqueciSenha from './pages/EsqueciSenha'
import NovaSenha from './pages/NovaSenha'
import Painel from './pages/Painel'
import MinhaEmpresa from './pages/MinhaEmpresa'
import Fornecedores from './pages/Fornecedores'
import Cotacoes from './pages/Cotacoes'
import CotacaoEditar from './pages/CotacaoEditar'
import CotacaoDetalhe from './pages/CotacaoDetalhe'
import ExigirCnpj from './components/ExigirCnpj'
import RotaAdmin from './components/RotaAdmin'
import AtivarConta from './pages/AtivarConta'
import Orcamentos from './pages/Orcamentos'

// telas carregadas só quando abertas (o app inicial fica menor e abre mais rápido)
const CotacaoImprimir = lazy(() => import('./pages/CotacaoImprimir'))
const Admin = lazy(() => import('./pages/Admin'))
const ResponderCotacao = lazy(() => import('./pages/ResponderCotacao'))
const OrcamentoEditar = lazy(() => import('./pages/OrcamentoEditar'))
const OrcamentoPublico = lazy(() => import('./pages/OrcamentoPublico'))
const PedidoResponder = lazy(() => import('./pages/PedidoResponder'))
const PedidoLink = lazy(() => import('./pages/PedidoLink'))
const VerificarAprovacao = lazy(() => import('./pages/VerificarAprovacao'))

function Inicio() {
  const { session, carregando } = useAuth()
  if (carregando) return <Carregando />
  return <Navigate to={session ? '/painel' : '/entrar'} replace />
}

export default function App() {
  return (
    <Suspense fallback={<Carregando />}>
    <Routes>
      <Route path="/" element={<Inicio />} />

      {/* Públicas */}
      <Route path="/entrar" element={<Entrar />} />
      <Route path="/cadastro" element={<Cadastro />} />
      <Route path="/esqueci-senha" element={<EsqueciSenha />} />
      <Route path="/nova-senha" element={<NovaSenha />} />

      {/* Conta AMP de outro app entrando pela 1ª vez no CotaCompara */}
      <Route path="/ativar" element={<AtivarConta />} />

      {/* Tela do fornecedor (sem login) */}
      <Route path="/r/:token" element={<ResponderCotacao />} />

      {/* Orçamento enviado pelo fornecedor ao cliente (sem login) */}
      <Route path="/o/:token" element={<OrcamentoPublico />} />

      {/* Pedido de orçamento enviado pelo cliente à empresa (sem login) */}
      <Route path="/p/:token" element={<PedidoLink />} />

      {/* Verificação pública de aprovação eletrônica / QR code (sem login) */}
      <Route path="/v/:codigo" element={<VerificarAprovacao />} />

      {/* Relatório para impressão (sem menu) */}
      <Route path="/cotacoes/:id/imprimir" element={<RotaProtegida><CotacaoImprimir /></RotaProtegida>} />

      {/* Painel do administrador da plataforma */}
      <Route path="/admin" element={<RotaAdmin><Admin /></RotaAdmin>} />

      {/* Área do comprador */}
      <Route element={<RotaProtegida><Layout /></RotaProtegida>}>
        <Route path="/painel" element={<Painel />} />
        <Route path="/minha-empresa" element={<MinhaEmpresa />} />
        <Route path="/fornecedores" element={<Fornecedores />} />
        <Route path="/cotacoes" element={<Cotacoes />} />
        <Route path="/cotacoes/nova" element={<ExigirCnpj><CotacaoEditar /></ExigirCnpj>} />
        <Route path="/cotacoes/:id" element={<CotacaoDetalhe />} />
        <Route path="/cotacoes/:id/editar" element={<CotacaoEditar />} />
        <Route path="/orcamentos" element={<Orcamentos />} />
        <Route path="/orcamentos/novo" element={<ExigirCnpj><OrcamentoEditar /></ExigirCnpj>} />
        <Route path="/orcamentos/:id" element={<OrcamentoEditar />} />
        <Route path="/pedidos/:token" element={<PedidoResponder />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </Suspense>
  )
}
