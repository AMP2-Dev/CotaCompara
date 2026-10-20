import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import Logo from './Logo'

export default function Header() {
  const { empresa, user, sair, isAdmin } = useAuth()
  const [aberto, setAberto] = useState(false)
  const fechar = () => setAberto(false)
  const classe = ({ isActive }) => (isActive ? 'ativo' : '')

  return (
    <header className="header">
      <div className="header-inner">
        <Logo to="/painel" />

        <nav className={`nav ${aberto ? 'aberto' : ''}`}>
          <NavLink to="/painel" className={classe} onClick={fechar}>Painel</NavLink>
          <NavLink to="/cotacoes" className={classe} onClick={fechar} title="Cotações que você pede aos seus fornecedores">Cotações</NavLink>
          <NavLink to="/fornecedores" className={classe} onClick={fechar}>Fornecedores</NavLink>
          <NavLink to="/orcamentos" className={classe} onClick={fechar} title="Orçamentos que você envia aos seus clientes">Clientes</NavLink>
          <NavLink to="/minha-empresa" className={classe} onClick={fechar}>Minha empresa</NavLink>
        </nav>

        <div className="user-box">
          {isAdmin && (
            <NavLink to="/admin" className="cadeado" title="Administração" aria-label="Administração" onClick={fechar}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
                strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" />
                <path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            </NavLink>
          )}
          <span className="nome" title={user?.email}>{empresa?.nome || user?.email}</span>
          <button className="link-sair" onClick={sair}>Sair</button>
        </div>

        <button className="menu-mobile" onClick={() => setAberto(!aberto)} aria-label="Menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.2" strokeLinecap="round">
            {aberto
              ? <path d="M6 6l12 12M18 6L6 18" />
              : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>
    </header>
  )
}
