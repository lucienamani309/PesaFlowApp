import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ShieldCheck, WifiOff, Wallet, TrendingUp, ArrowRight, Mail, Chrome, ChevronLeft, LogOut, Coins, Settings2, CheckCircle2, Plus, Trash2, PieChart, LayoutDashboard, Receipt, PiggyBank, History, Menu, X, Bell, Search, AlertCircle, TrendingDown, ArrowUpRight, ArrowDownRight, Filter } from 'lucide-react';
import { auth, googleProvider, signInWithPopup, sendSignInLinkToEmail, db } from './lib/firebase';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, onSnapshot, orderBy, limit, Timestamp } from 'firebase/firestore';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type View = 'landing' | 'auth' | 'onboarding' | 'app';
type Tab = 'dashboard' | 'budget' | 'expenses' | 'savings';
type OnboardingStep = 1 | 2 | 3;
type BudgetType = 'need' | 'want' | 'saving';
type BudgetRule = '50/30/20' | 'custom';
type PaymentMethod = 'Cash' | 'Mobile Money' | 'Banque';

interface BudgetLine {
  id: string;
  name: string;
  type: BudgetType;
  amount: number;
}

interface Expense {
  id: string;
  userId: string;
  amount: number;
  category: string;
  categoryType: BudgetType;
  description: string;
  date: Timestamp;
  paymentMethod: PaymentMethod;
}

interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  hasCompletedOnboarding: boolean;
  monthlyIncome: number;
  budgetRule: BudgetRule;
  budgetLines: BudgetLine[];
  savingsGoal: number;
  currency: string;
}

interface MonthlyBudget {
  id: string;
  userId: string;
  month: number;
  year: number;
  income: number;
  rule: BudgetRule;
  lines: BudgetLine[];
  status: 'active' | 'archived';
  createdAt: string;
}

const DEFAULT_CATEGORIES: BudgetLine[] = [
  { id: '1', name: 'Dîme', type: 'need', amount: 0 },
  { id: '2', name: 'Nourriture', type: 'need', amount: 0 },
  { id: '3', name: 'Transport', type: 'need', amount: 0 },
  { id: '4', name: 'Logement', type: 'need', amount: 0 },
  { id: '5', name: 'Santé', type: 'need', amount: 0 },
  { id: '6', name: 'Électricité & Eau', type: 'need', amount: 0 },
  { id: '7', name: 'Communication', type: 'need', amount: 0 },
  { id: '8', name: 'Scolarité', type: 'need', amount: 0 },
  { id: '9', name: 'Loisirs', type: 'want', amount: 0 },
  { id: '10', name: 'Épargne', type: 'saving', amount: 0 },
  { id: '11', name: 'Imprévus', type: 'saving', amount: 0 },
  { id: '12', name: 'Shopping', type: 'want', amount: 0 },
  { id: '13', name: 'Autres', type: 'want', amount: 0 },
];

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [activeTab, setActiveTab] = useState<Tab>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [monthlyBudgets, setMonthlyBudgets] = useState<MonthlyBudget[]>([]);
  const [authReady, setAuthReady] = useState(false);

  // App control
  const [isCreatingBudget, setIsCreatingBudget] = useState(false);
  const [isAddingExpense, setIsAddingExpense] = useState(false);

  const changeCurrency = async (curr: string) => {
    if (!user) return;
    try {
      await updateDoc(doc(db, 'users', user.uid), { currency: curr });
    } catch (e) {
       console.error("Error updating currency", e);
    }
  };

  const addExpense = async (data: { amount: number; categoryId: string; description: string; date: Date; paymentMethod: PaymentMethod }) => {
    if (!user || !profile) return;
    setIsLoading(true);
    try {
      const categoryLine = profile.budgetLines.find(l => l.id === data.categoryId);
      await setDoc(doc(collection(db, 'expenses')), {
        userId: user.uid,
        amount: data.amount,
        category: categoryLine?.name || 'Inconnue',
        categoryType: categoryLine?.type || 'want',
        description: data.description,
        date: Timestamp.fromDate(data.date),
        paymentMethod: data.paymentMethod,
        createdAt: new Date().toISOString()
      });
      setIsAddingExpense(false);
    } catch (error) {
      console.error('Add expense error:', error);
      alert('Erreur lors de l\'ajout de la dépense.');
    } finally {
      setIsLoading(false);
    }
  };

  // Onboarding state
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(1);
  const [income, setIncome] = useState<number>(0);
  const [budgetRule, setBudgetRule] = useState<BudgetRule>('50/30/20');
  const [budgetLines, setBudgetLines] = useState<BudgetLine[]>([]);
  const [savingsGoal, setSavingsGoal] = useState<number>(0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        const userDocRef = doc(db, 'users', currentUser.uid);
        
        // Listen to profile changes
        const unsubsProfile = onSnapshot(userDocRef, (docSnap) => {
          if (docSnap.exists()) {
            const data = docSnap.data() as UserProfile;
            setProfile(data);
            
            // Set initial onboarding values from profile if available
            if (data.monthlyIncome) setIncome(data.monthlyIncome);
            if (data.budgetRule) setBudgetRule(data.budgetRule);
            if (data.budgetLines) setBudgetLines(data.budgetLines);
            if (data.savingsGoal) setSavingsGoal(data.savingsGoal);

            if (data.hasCompletedOnboarding) {
              setView('app');
            } else {
              setView('onboarding');
            }
          } else {
            // New user entry
            setDoc(userDocRef, {
              uid: currentUser.uid,
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              createdAt: new Date().toISOString(),
              hasCompletedOnboarding: false,
              currency: 'XOF'
            });
            setView('onboarding');
          }
        });

        // Listen to expenses
        const expensesQuery = query(
          collection(db, 'expenses'),
          where('userId', '==', currentUser.uid),
          orderBy('date', 'desc'),
          limit(50)
        );
        const unsubsExpenses = onSnapshot(expensesQuery, (snap) => {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as Expense));
          setExpenses(list);
        });

        // Listen to monthly budgets
        const budgetsQuery = query(
          collection(db, 'monthlyBudgets'),
          where('userId', '==', currentUser.uid),
          orderBy('year', 'desc'),
          orderBy('month', 'desc')
        );
        const unsubsBudgets = onSnapshot(budgetsQuery, (snap) => {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() } as MonthlyBudget));
          setMonthlyBudgets(list);
        });

        return () => {
          unsubsProfile();
          unsubsExpenses();
          unsubsBudgets();
        };
      } else {
        setView('landing');
      }
      setAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const actionCodeSettings = {
        url: window.location.href,
        handleCodeInApp: true,
      };
      await sendSignInLinkToEmail(auth, email, actionCodeSettings);
      window.localStorage.setItem('emailForSignIn', email);
      alert('Un lien de connexion a été envoyé à votre adresse email.');
      setIsLoading(false);
    } catch (error) {
      console.error('Email link error:', error);
      alert('Erreur lors de l\'envoi de l\'email.');
      setIsLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    try {
      await signInWithPopup(auth, googleProvider);
      // view will change via onAuthStateChanged
    } catch (error) {
      console.error('Google login error:', error);
      alert('Erreur lors de la connexion avec Google.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  const finishOnboarding = async () => {
    if (!user) return;
    setIsLoading(true);
    try {
      // First save to user profile (current settings)
      await updateDoc(doc(db, 'users', user.uid), {
        hasCompletedOnboarding: true,
        monthlyIncome: income,
        budgetRule,
        budgetLines,
        savingsGoal,
      });

      // Also create the first monthly budget record
      const now = new Date();
      await setDoc(doc(collection(db, 'monthlyBudgets')), {
        userId: user.uid,
        month: now.getMonth(),
        year: now.getFullYear(),
        income,
        rule: budgetRule,
        lines: budgetLines,
        status: 'active',
        createdAt: now.toISOString(),
      });

      setView('app');
    } catch (error) {
      console.error('Onboarding save error:', error);
      alert('Erreur lors de l\'enregistrement de vos préférences.');
    } finally {
      setIsLoading(false);
    }
  };

  const createSpecificBudget = async (m: number, y: number) => {
    if (!user) return;
    setIsLoading(true);
    try {
      await setDoc(doc(collection(db, 'monthlyBudgets')), {
        userId: user.uid,
        month: m,
        year: y,
        income,
        rule: budgetRule,
        lines: budgetLines,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
      setIsCreatingBudget(false);
      // Reset state
      setOnboardingStep(1);
    } catch (error) {
      console.error('Budget creation error:', error);
      alert('Erreur lors de la création du budget.');
    } finally {
      setIsLoading(false);
    }
  };

  const duplicateBudget = async (sourceBudget: MonthlyBudget) => {
    if (!user) return;
    setIsLoading(true);
    try {
      const nextMonth = (sourceBudget.month + 1) % 12;
      const nextYear = nextMonth === 0 ? sourceBudget.year + 1 : sourceBudget.year;

      await setDoc(doc(collection(db, 'monthlyBudgets')), {
        userId: user.uid,
        month: nextMonth,
        year: nextYear,
        income: sourceBudget.income,
        rule: sourceBudget.rule,
        lines: sourceBudget.lines,
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.error('Budget duplication error:', error);
      alert('Erreur lors de la duplication du budget.');
    } finally {
      setIsLoading(false);
    }
  };

  const applyRuleTemplate = () => {
    if (budgetRule === '50/30/20') {
      const needsPool = income * 0.5;
      const wantsPool = income * 0.3;
      const savingsPool = income * 0.2;

      // Distribution for default categories
      const newLines = DEFAULT_CATEGORIES.map(line => {
        let amount = 0;
        if (line.type === 'need') {
          amount = needsPool / DEFAULT_CATEGORIES.filter(l => l.type === 'need').length;
        } else if (line.type === 'want') {
          amount = wantsPool / DEFAULT_CATEGORIES.filter(l => l.type === 'want').length;
        } else {
          amount = savingsPool / DEFAULT_CATEGORIES.filter(l => l.type === 'saving').length;
        }
        return { ...line, amount: Math.floor(amount) };
      });
      setBudgetLines(newLines);
    } else {
      // Start with empty or one default line for custom
      setBudgetLines([{ id: crypto.randomUUID(), name: '', type: 'need', amount: 0 }]);
    }
    setOnboardingStep(3);
  };

  const addCustomLine = () => {
    setBudgetLines([...budgetLines, { id: crypto.randomUUID(), name: '', type: 'need', amount: 0 }]);
  };

  const removeLine = (id: string) => {
    setBudgetLines(budgetLines.filter(l => l.id !== id));
  };

  const updateLine = (id: string, updates: Partial<BudgetLine>) => {
    setBudgetLines(budgetLines.map(l => l.id === id ? { ...l, ...updates } : l));
  };

  const totalAllocated = budgetLines.reduce((sum, l) => sum + l.amount, 0);
  const remaining = income - totalAllocated;

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#0A0F1D] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0F1D] text-slate-100 font-sans selection:bg-emerald-500/30 selection:text-emerald-200 relative overflow-hidden flex flex-col">
      {/* Background Blobs - Consistants à travers les vues */}
      <div className="absolute top-[-10%] left-[-5%] w-[400px] h-[400px] bg-emerald-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute top-[40%] right-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none"></div>
      <div className="absolute bottom-[-10%] left-[20%] w-[600px] h-[600px] bg-emerald-900/20 rounded-full blur-[150px] pointer-events-none"></div>

      <AnimatePresence mode="wait">
        {view === 'landing' && (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ duration: 0.4 }}
            className="flex-1 flex flex-col"
          >
            {/* Navigation */}
            <nav className="fixed top-0 w-full bg-[#0A0F1D]/50 backdrop-blur-xl z-50 border-b border-white/5">
              <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-24 items-center">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-tr from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                      <span className="text-white font-bold text-xl">P</span>
                    </div>
                    <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">PesaFlow</span>
                  </div>
                  <button 
                    onClick={() => setView('auth')}
                    className="px-6 py-3 bg-white/5 border border-white/10 backdrop-blur-md rounded-full text-white hover:bg-white/10 transition-all font-medium text-sm"
                  >
                    Connexion
                  </button>
                </div>
              </div>
            </nav>

            <main className="pt-36 pb-16 relative z-10 flex-1">
              <section className="px-4 py-12 sm:py-20 max-w-5xl mx-auto text-center">
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5 }}
                  className="flex flex-col items-center"
                >
                  <div className="mb-8 inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[11px] font-bold uppercase tracking-widest w-fit">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                    </span>
                    Pensé pour l'Afrique
                  </div>

                  <h1 className="text-5xl sm:text-7xl lg:text-[5rem] font-extrabold tracking-tight text-white mb-8 leading-[1.1]">
                    Prenez le contrôle de <br className="hidden sm:block" />
                    <span className="text-emerald-400 relative whitespace-nowrap">
                      votre argent.
                      <svg className="absolute w-full h-3 sm:h-4 -bottom-1 sm:-bottom-2 left-0 text-emerald-500/30" viewBox="0 0 100 10" preserveAspectRatio="none">
                        <path d="M0 5 Q 50 10 100 5" stroke="currentColor" strokeWidth="4" fill="none" strokeLinecap="round" />
                      </svg>
                    </span>
                  </h1>
                  <p className="text-lg sm:text-xl text-slate-400 mb-10 max-w-2xl mx-auto leading-relaxed">
                    La gestion de dépenses conçue pour vos réalités : suivi hors ligne complet, prise en charge des revenus irréguliers et discipline d'épargne.
                  </p>
                  <button 
                    onClick={() => setView('auth')}
                    className="inline-flex items-center justify-center gap-2 bg-emerald-500 text-slate-950 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 active:scale-95"
                  >
                    Commencer gratuitement <ArrowRight size={20} />
                  </button>
                </motion.div>

                <motion.div 
                  initial={{ opacity: 0, y: 40 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.7, delay: 0.2 }}
                  className="mt-24 mx-auto max-w-4xl"
                >
                  <div className="relative rounded-[3rem] bg-slate-900/40 backdrop-blur-2xl border border-white/10 shadow-2xl overflow-hidden aspect-[16/10] sm:aspect-[21/10] p-4 sm:p-6 pb-0">
                    <div className="w-full h-full bg-slate-950/80 rounded-t-[2rem] sm:rounded-[2rem] border border-white/5 flex flex-col pt-6 overflow-hidden relative shadow-inner">
                       <div className="absolute top-6 left-6 flex items-center gap-2 hidden sm:flex">
                          <div className="w-3 h-3 rounded-full bg-slate-700"></div>
                          <div className="w-3 h-3 rounded-full bg-slate-700"></div>
                          <div className="w-3 h-3 rounded-full bg-slate-700"></div>
                       </div>
                       <div className="flex-1 mt-0 sm:mt-10 p-6 flex flex-col gap-6">
                         <div className="flex gap-4">
                           <div className="w-1/2 sm:w-1/3 h-28 bg-emerald-500/10 rounded-2xl border border-emerald-500/20 p-5 flex flex-col justify-between">
                              <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-inner">
                                 <div className="w-4 h-4 bg-emerald-400 rounded-sm"></div>
                              </div>
                              <div>
                                 <div className="text-[10px] text-emerald-500 font-bold tracking-wider mb-1">SOLDE ACTUEL</div>
                                 <div className="h-6 w-24 sm:w-32 bg-emerald-400 rounded"></div>
                              </div>
                           </div>
                           <div className="w-1/2 sm:w-1/3 h-28 bg-white/5 rounded-2xl border border-white/5 p-5 flex flex-col justify-between">
                              <div className="w-10 h-10 rounded-full bg-white/10"></div>
                              <div>
                                 <div className="text-[10px] text-slate-500 font-bold tracking-wider mb-1">DÉPENSES</div>
                                 <div className="h-6 w-20 sm:w-28 bg-slate-300/80 rounded"></div>
                              </div>
                           </div>
                           <div className="w-1/3 h-28 bg-white/5 rounded-2xl border border-white/5 p-5 flex flex-col justify-between hidden sm:flex">
                              <div className="w-10 h-10 rounded-full bg-white/10"></div>
                              <div>
                                 <div className="text-[10px] text-slate-500 font-bold tracking-wider mb-1">ÉPARGNE</div>
                                 <div className="h-6 w-32 bg-slate-300/80 rounded"></div>
                              </div>
                           </div>
                         </div>
                         <div className="flex-1 bg-white/5 rounded-2xl border border-white/5 p-6 flex items-end gap-3 sm:gap-4 px-6 sm:px-8 relative overflow-hidden">
                            <div className="w-full h-[30%] bg-white/10 rounded-t-lg sm:rounded-t-xl transition-all duration-1000"></div>
                            <div className="w-full h-[50%] bg-white/10 rounded-t-lg sm:rounded-t-xl transition-all duration-1000"></div>
                            <div className="w-full h-[80%] bg-emerald-500 rounded-t-lg sm:rounded-t-xl transition-all duration-1000 relative shadow-[0_0_20px_rgba(16,185,129,0.3)]">
                               <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-emerald-500 text-slate-950 text-xs font-bold px-3 py-1 rounded-full">+12%</div>
                            </div>
                            <div className="w-full h-[40%] bg-white/10 rounded-t-lg sm:rounded-t-xl transition-all duration-1000"></div>
                            <div className="w-full h-[60%] bg-white/10 rounded-t-lg sm:rounded-t-xl transition-all duration-1000 hidden sm:block"></div>
                            <div className="w-full h-[70%] bg-emerald-500/40 rounded-t-lg sm:rounded-t-xl transition-all duration-1000 hidden sm:block"></div>
                            <div className="w-full h-[90%] bg-emerald-400 rounded-t-lg sm:rounded-t-xl transition-all duration-1000 hidden sm:block"></div>
                         </div>
                       </div>
                    </div>
                  </div>
                </motion.div>
              </section>

              <section className="py-24 relative z-10">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                  <div className="text-center mb-16">
                    <h2 className="text-3xl sm:text-5xl font-extrabold tracking-tight text-white mb-6">
                      Pensé pour la vraie vie
                    </h2>
                    <p className="text-slate-400 max-w-2xl mx-auto text-lg leading-relaxed">
                      Pas besoin d'outils compliqués. PesaFlow va à l'essentiel pour vous donner une vision claire de votre argent.
                    </p>
                  </div>

                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
                    {[
                      { icon: <WifiOff size={24} />, title: "100% Hors-ligne", desc: "Saisissez vos dépenses sans internet. L'application synchronise vos données dès que vous retrouvez du réseau." },
                      { icon: <ShieldCheck size={24} />, title: "Revenus variables", desc: "Gérez sereinement les mois sans salaire fixe. Votre budget s'adapte à vos entrées d'argent." },
                      { icon: <TrendingUp size={24} />, title: "Objectifs concrets", desc: "Définissez des cibles d'épargne. L'app vous aide à mettre de côté avant de tout dépenser." },
                      { icon: <Wallet size={24} />, title: "Vision claire", desc: "Des visuels simples et modernes pour comprendre immédiatement vos plus grands postes de dépenses." },
                    ].map((feature, i) => (
                      <motion.div 
                        initial={{ opacity: 0, y: 20 }}
                        whileInView={{ opacity: 1, y: 0 }}
                        viewport={{ once: true }}
                        transition={{ delay: i * 0.1 }}
                        key={i} 
                        className="bg-white/5 backdrop-blur-sm rounded-3xl p-8 border border-white/10 hover:bg-white/10 transition-all group"
                      >
                        <div className="w-12 h-12 bg-emerald-500/20 border border-emerald-500/20 rounded-xl shadow-inner flex items-center justify-center text-emerald-400 mb-6 group-hover:scale-110 transition-transform">
                          {feature.icon}
                        </div>
                        <h3 className="text-xl font-bold text-white mb-3 tracking-tight">{feature.title}</h3>
                        <p className="text-slate-400 leading-relaxed text-sm">
                          {feature.desc}
                        </p>
                      </motion.div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="py-24 px-4 sm:px-6 relative z-10">
                <div className="max-w-4xl mx-auto bg-slate-900/40 backdrop-blur-2xl border border-white/10 rounded-[3rem] p-10 sm:p-16 text-center relative overflow-hidden shadow-2xl">
                  <div className="absolute top-0 right-0 p-40 bg-emerald-600/20 blur-[120px] rounded-full transform translate-x-1/2 -translate-y-1/2 pointer-events-none"></div>
                  <div className="absolute bottom-0 left-0 p-40 bg-indigo-600/20 blur-[120px] rounded-full transform -translate-x-1/2 translate-y-1/2 pointer-events-none"></div>
                  <div className="relative z-10">
                    <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-6 tracking-tight">
                      Prêt à changer vos <br className="hidden sm:block" /> habitudes financières ?
                    </h2>
                    <p className="text-slate-400 mb-10 text-lg max-w-xl mx-auto">
                      Rejoignez PesaFlow aujourd'hui et commencez à construire une relation saine avec votre argent.
                    </p>
                    <button 
                      onClick={() => setView('auth')}
                      className="bg-emerald-500 text-slate-950 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-emerald-400 transition-colors shadow-xl shadow-emerald-500/20 active:scale-95 inline-flex"
                    >
                      Pour commencer
                    </button>
                  </div>
                </div>
              </section>
            </main>

            <footer className="relative z-10 bg-[#0A0F1D]/80 backdrop-blur-md border-t border-white/5 py-8 px-8 sm:py-12 mt-auto">
              <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 font-bold text-sm flex items-center justify-center border border-emerald-500/20">
                    P
                  </div>
                  <span className="text-xl font-bold tracking-tight text-slate-100">PesaFlow</span>
                </div>
                <p className="text-slate-500 text-sm">
                  © {new Date().getFullYear()} PesaFlow — Développé pour l'inclusion financière.
                </p>
                <div className="flex gap-6">
                  <span className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold cursor-pointer hover:text-emerald-400 transition-colors">App Store</span>
                  <span className="text-[11px] text-slate-500 uppercase tracking-widest font-semibold cursor-pointer hover:text-emerald-400 transition-colors">Google Play</span>
                </div>
              </div>
            </footer>
          </motion.div>
        )}

        {view === 'auth' && (
          <motion.div
            key="auth"
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            className="flex-1 flex items-center justify-center p-4 relative z-10"
          >
            <div className="max-w-md w-full">
              <button 
                onClick={() => setView('landing')}
                className="mb-8 flex items-center gap-2 text-slate-400 hover:text-white transition-colors group"
              >
                <ChevronLeft size={20} className="group-hover:-translate-x-1 transition-transform" />
                Retour
              </button>

              <div className="bg-slate-900/40 backdrop-blur-2xl p-8 sm:p-10 rounded-[2.5rem] shadow-2xl border border-white/10 relative overflow-hidden">
                <div className="absolute top-0 right-0 p-24 bg-emerald-500 blur-[80px] rounded-full opacity-10 pointer-events-none"></div>
                
                <div className="relative z-10">
                  <div className="mb-8">
                    <h2 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Bienvenue</h2>
                    <p className="text-slate-400 leading-relaxed">Connectez-vous ou créez un compte pour commencer à gérer vos finances.</p>
                  </div>

                  <form onSubmit={handleLogin} className="space-y-6">
                    <div className="space-y-2">
                      <label className="text-sm font-semibold tracking-wide text-slate-300 block ml-1 uppercase">Email</label>
                      <div className="relative group">
                        <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-emerald-400 transition-colors" size={20} />
                        <input 
                          type="email" 
                          required
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="votre@email.com"
                          className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-12 pr-4 text-white placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                        />
                      </div>
                    </div>

                    <button 
                      type="submit"
                      disabled={isLoading}
                      className="w-full bg-emerald-500 text-slate-950 font-bold py-4 rounded-2xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {isLoading ? (
                        <div className="w-6 h-6 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <>Continuer avec l'email <ArrowRight size={20} /></>
                      )}
                    </button>
                  </form>

                  <div className="my-8 flex items-center gap-4 text-slate-600">
                    <div className="h-px bg-white/10 flex-1"></div>
                    <span className="text-xs font-bold uppercase tracking-widest">ou</span>
                    <div className="h-px bg-white/10 flex-1"></div>
                  </div>

                  <button 
                    onClick={handleGoogleLogin}
                    disabled={isLoading}
                    className="w-full bg-white/5 border border-white/10 text-white font-bold py-4 rounded-2xl hover:bg-white/10 transition-all flex items-center justify-center gap-3 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Chrome size={20} className="text-emerald-400" />
                    Continuer avec Google
                  </button>

                  <p className="mt-8 text-center text-xs text-slate-500 leading-relaxed">
                    En continuant, vous acceptez nos <span className="text-slate-300 underline cursor-pointer hover:text-emerald-400">Conditions d'Utilisation</span> et notre <span className="text-slate-300 underline cursor-pointer hover:text-emerald-400">Politique de Confidentialité</span>.
                  </p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {view === 'onboarding' && (
          <motion.div
            key="onboarding"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="flex-1 flex items-center justify-center p-4 relative z-10"
          >
            <div className="max-w-2xl w-full bg-slate-900/40 backdrop-blur-2xl p-8 sm:p-12 rounded-[3.5rem] border border-white/10 shadow-2xl relative overflow-hidden">
               {/* Progress Bar */}
               <div className="absolute top-0 left-0 w-full h-1.5 bg-white/5">
                 <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${(onboardingStep / 3) * 100}%` }}
                    className="h-full bg-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.5)]"
                 ></motion.div>
               </div>

               <AnimatePresence mode="wait">
                 {onboardingStep === 1 && (
                   <motion.div
                     key="step1"
                     initial={{ opacity: 0, x: 20 }}
                     animate={{ opacity: 1, x: 0 }}
                     exit={{ opacity: 0, x: -20 }}
                     className="space-y-8"
                   >
                     <div className="space-y-4">
                       <div className="w-16 h-16 bg-emerald-500/20 text-emerald-400 rounded-2xl flex items-center justify-center mb-4">
                         <Coins size={32} />
                       </div>
                       <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                         Quel est votre revenu <br/><span className="text-emerald-400">mensuel moyen ?</span>
                       </h2>
                       <p className="text-slate-400 text-lg">Même une estimation nous aidera à structurer votre budget prévisionnel.</p>
                     </div>
                     <div className="relative group">
                       <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xl group-focus-within:text-emerald-400 transition-colors">FCFA</span>
                       <input 
                         type="number"
                         value={income || ''}
                         onChange={(e) => setIncome(Number(e.target.value))}
                         onKeyDown={(e) => e.key === 'Enter' && income > 0 && setOnboardingStep(2)}
                         placeholder="Ex: 250000"
                         className="w-full bg-white/5 border-2 border-white/10 rounded-3xl py-8 pl-24 pr-8 text-3xl font-mono font-bold text-white focus:outline-none focus:border-emerald-500 transition-all placeholder:text-slate-700"
                       />
                     </div>
                     <button 
                       disabled={income <= 0}
                       onClick={() => setOnboardingStep(2)}
                       className="w-full bg-emerald-500 text-slate-950 font-bold py-5 rounded-3xl hover:bg-emerald-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-xl shadow-xl shadow-emerald-500/20"
                     >
                       Suivant <ArrowRight className="inline ml-2" size={24} />
                     </button>
                   </motion.div>
                 )}

                 {onboardingStep === 2 && (
                   <motion.div
                     key="step2"
                     initial={{ opacity: 0, x: 20 }}
                     animate={{ opacity: 1, x: 0 }}
                     exit={{ opacity: 0, x: -20 }}
                     className="space-y-8"
                   >
                     <div className="space-y-4">
                       <button onClick={() => setOnboardingStep(1)} className="text-slate-500 hover:text-white flex items-center gap-2 mb-4 group">
                         <ChevronLeft size={20} className="group-hover:-translate-x-1 transition-transform" /> Revenu
                       </button>
                       <h2 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight leading-tight">
                         Choisissez votre <br/><span className="text-emerald-400">stratégie budgétaire.</span>
                       </h2>
                       <p className="text-slate-400 text-lg">Comment souhaitez-vous répartir votre argent ?</p>
                     </div>
                     <div className="grid sm:grid-cols-2 gap-4">
                        <button 
                          onClick={() => setBudgetRule('50/30/20')}
                          className={`p-6 rounded-3xl border-2 text-left transition-all relative overflow-hidden group ${budgetRule === '50/30/20' ? 'bg-emerald-500/10 border-emerald-500 shadow-xl' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
                        >
                          <PieChart className={`mb-4 ${budgetRule === '50/30/20' ? 'text-emerald-400' : 'text-slate-500'}`} size={32} />
                          <h4 className="text-xl font-bold text-white mb-2">Modèle 50/30/20</h4>
                          <p className="text-sm text-slate-400 leading-relaxed">
                            <span className="text-emerald-400 font-bold">50%</span> Besoins<br/>
                            <span className="text-amber-400 font-bold">30%</span> Envies<br/>
                            <span className="text-indigo-400 font-bold">20%</span> Épargne & Dettes
                          </p>
                        </button>
                        <button 
                          onClick={() => setBudgetRule('custom')}
                          className={`p-6 rounded-3xl border-2 text-left transition-all ${budgetRule === 'custom' ? 'bg-emerald-500/10 border-emerald-500 shadow-xl' : 'bg-white/5 border-white/10 hover:border-white/20'}`}
                        >
                          <Settings2 className={`mb-4 ${budgetRule === 'custom' ? 'text-emerald-400' : 'text-slate-500'}`} size={32} />
                          <h4 className="text-xl font-bold text-white mb-2">Sur mesure</h4>
                          <p className="text-sm text-slate-400 leading-relaxed">
                            Définissez vos propres catégories et montants selon vos besoins réels.
                          </p>
                        </button>
                     </div>
                     <button 
                       onClick={applyRuleTemplate}
                       className="w-full bg-emerald-500 text-slate-950 font-bold py-5 rounded-3xl hover:bg-emerald-400 transition-all text-xl shadow-xl shadow-emerald-500/20"
                     >
                       Configurer mon budget
                     </button>
                   </motion.div>
                 )}

                 {onboardingStep === 3 && (
                   <motion.div
                     key="step3"
                     initial={{ opacity: 0, x: 20 }}
                     animate={{ opacity: 1, x: 0 }}
                     exit={{ opacity: 0, x: -20 }}
                     className="space-y-6"
                   >
                     <div className="flex justify-between items-center bg-white/5 p-6 rounded-3xl border border-white/10">
                        <div>
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Restant à allouer</p>
                          <p className={`text-2xl font-mono font-bold ${remaining < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{remaining.toLocaleString()} FCFA</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Revenu Total</p>
                          <p className="text-2xl font-mono font-bold text-white">{income.toLocaleString()} FCFA</p>
                        </div>
                     </div>

                     <div className="space-y-4 max-h-[380px] overflow-y-auto pr-2 custom-scrollbar">
                        {budgetLines.map((line) => (
                           <div key={line.id} className="bg-white/5 p-4 rounded-2xl border border-white/5 flex gap-3 items-center group hover:bg-white/10 transition-colors">
                              <div className="flex flex-col gap-1 w-20 sm:w-24">
                                <select 
                                  value={line.type}
                                  onChange={(e) => updateLine(line.id, { type: e.target.value as BudgetType })}
                                  className="bg-slate-800 text-[10px] text-slate-300 font-bold rounded-lg px-2 py-1.5 focus:ring-1 focus:ring-emerald-500 outline-none uppercase tracking-tighter"
                                >
                                  <option value="need">Besoin</option>
                                  <option value="want">Envie</option>
                                  <option value="saving">Épargne</option>
                                </select>
                              </div>
                              <input 
                                type="text"
                                value={line.name}
                                onChange={(e) => updateLine(line.id, { name: e.target.value })}
                                placeholder="Désignation"
                                className="flex-1 bg-transparent border-none text-white focus:ring-0 placeholder:text-slate-700 text-sm font-medium"
                              />
                              <div className="relative w-28 sm:w-36">
                                <input 
                                  type="number"
                                  value={line.amount || ''}
                                  onChange={(e) => updateLine(line.id, { amount: Number(e.target.value) })}
                                  className="w-full bg-white/5 rounded-xl py-2 px-3 text-right font-mono text-emerald-400 border border-white/5 focus:border-emerald-500 outline-none text-sm"
                                  placeholder="0"
                                />
                              </div>
                              <button onClick={() => removeLine(line.id)} className="text-slate-600 hover:text-rose-400 transition-colors p-2 shrink-0">
                                <Trash2 size={18} />
                              </button>
                           </div>
                        ))}
                        
                        <button 
                          onClick={addCustomLine}
                          className="w-full border-2 border-dashed border-white/5 rounded-2xl py-4 text-slate-500 hover:bg-white/5 hover:text-white transition-all flex items-center justify-center gap-2 text-sm font-bold uppercase tracking-widest"
                        >
                          <Plus size={18} /> Ajouter une ligne
                        </button>
                     </div>

                     <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl space-y-3">
                        <label className="text-[10px] font-bold text-emerald-400 uppercase tracking-widest flex items-center gap-2">
                          🎯 Objectif d'épargne (Optionnel)
                        </label>
                        <input 
                          type="number"
                          value={savingsGoal || ''}
                          onChange={(e) => setSavingsGoal(Number(e.target.value))}
                          placeholder="Ex: 1 000 000 pour un terrain"
                          className="w-full bg-transparent border-b border-emerald-500/20 text-white text-xl font-mono focus:border-emerald-500 outline-none pb-2 transition-all placeholder:text-slate-700"
                        />
                     </div>

                     <div className="flex gap-4 pt-4">
                        <button onClick={() => setOnboardingStep(2)} className="w-1/3 bg-white/5 text-white font-bold py-5 rounded-3xl hover:bg-white/10 transition-all flex items-center justify-center">
                          Retour
                        </button>
                        <button 
                          disabled={isLoading || budgetLines.some(l => !l.name) || income <= 0}
                          onClick={finishOnboarding}
                          className="flex-1 bg-emerald-500 text-slate-950 font-bold py-5 rounded-3xl hover:bg-emerald-400 transition-all flex items-center justify-center gap-2 text-xl shadow-xl shadow-emerald-500/20 disabled:opacity-50"
                        >
                          {isLoading ? (
                            <div className="w-6 h-6 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></div>
                          ) : (
                            <><CheckCircle2 size={24} /> Terminer</>
                          )}
                        </button>
                     </div>
                   </motion.div>
                 )}
               </AnimatePresence>
            </div>
          </motion.div>
        )}

        {view === 'app' && profile && (
          <div className="flex-1 flex overflow-hidden lg:flex-row flex-col">
            {/* Sidebar (Desktop) */}
            <aside className="hidden lg:flex w-72 bg-slate-900/60 backdrop-blur-3xl border-r border-white/5 flex-col p-8 shrink-0">
              <div className="flex items-center gap-3 mb-12">
                <div className="w-10 h-10 bg-gradient-to-tr from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-500/20">
                  <span className="text-white font-bold text-xl">P</span>
                </div>
                <span className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">PesaFlow</span>
              </div>

              <nav className="flex-1 space-y-2">
                <NavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={20} />} label="Dashboard" />
                <NavButton active={activeTab === 'budget'} onClick={() => setActiveTab('budget')} icon={<PieChart size={20} />} label="Budget" />
                <NavButton active={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} icon={<Receipt size={20} />} label="Dépenses" />
                <NavButton active={activeTab === 'savings'} onClick={() => setActiveTab('savings')} icon={<PiggyBank size={20} />} label="Épargne" />
              </nav>

              <div className="mt-auto pt-8 border-t border-white/5">
                <div className="flex items-center gap-3 p-4 bg-white/5 rounded-2xl mb-4 group cursor-pointer hover:bg-white/10 transition-all">
                  <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-800 border border-white/10">
                    {profile.photoURL ? <img src={profile.photoURL} alt="Profile" /> : <div className="w-full h-full flex items-center justify-center text-slate-500 italic">?</div>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-white truncate">{profile.displayName || 'Utilisateur'}</p>
                    <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">Menu Profil</p>
                  </div>
                </div>
                <button 
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 p-4 text-rose-400 hover:bg-rose-400/10 rounded-2xl transition-all"
                >
                  <LogOut size={20} />
                  <span className="font-bold text-sm">Déconnexion</span>
                </button>
              </div>
            </aside>

            {/* Main Content Area */}
            <main className="flex-1 flex flex-col h-full bg-[#0A0F1D] overflow-hidden">
               {/* Top Bar */}
               <header className="h-20 border-b border-white/5 flex items-center justify-between px-6 sm:px-10 shrink-0 relative z-20">
                  <div className="flex items-center gap-4 lg:hidden">
                    <button onClick={() => setIsSidebarOpen(true)} className="p-2 text-slate-400 hover:text-white">
                      <Menu size={24} />
                    </button>
                    <span className="text-xl font-bold tracking-tight text-white">PesaFlow</span>
                  </div>

                  <div className="hidden sm:flex items-center gap-3 bg-white/5 px-4 py-2 rounded-2xl border border-white/10 w-96 group focus-within:ring-2 focus-within:ring-emerald-500/30 transition-all">
                    <Search size={18} className="text-slate-500" />
                    <input type="text" placeholder="Rechercher une dépense..." className="bg-transparent border-none outline-none text-sm text-white w-full placeholder:text-slate-600" />
                  </div>

                  <div className="flex items-center gap-4">
                    <select 
                      value={profile.currency}
                      onChange={(e) => changeCurrency(e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-xl px-2 py-1 text-[10px] font-bold text-white outline-none focus:ring-1 focus:ring-emerald-500"
                    >
                      <option value="XOF">XOF</option>
                      <option value="USD">USD</option>
                      <option value="CDF">CDF</option>
                      <option value="RWF">RWF</option>
                    </select>

                    <button className="relative p-2 text-slate-400 hover:text-white transition-colors">
                      <Bell size={22} />
                      <span className="absolute top-2 right-2 w-2 h-2 bg-rose-500 rounded-full border-2 border-[#0A0F1D]"></span>
                    </button>
                    <div className="h-10 w-px bg-white/5 mx-2 hidden sm:block"></div>
                    <div className="flex items-center gap-3 text-right">
                      <div className="hidden sm:block">
                         <p className="text-xs font-bold text-white">{profile.monthlyIncome?.toLocaleString()} {profile.currency}</p>
                         <p className="text-[9px] text-slate-500 font-bold uppercase tracking-widest">Revenu mensuel</p>
                      </div>
                      <div className="w-10 h-10 rounded-xl overflow-hidden border border-white/10 lg:hidden">
                        {profile.photoURL ? <img src={profile.photoURL} alt="User" /> : <div className="w-full h-full bg-slate-800" />}
                      </div>
                    </div>
                  </div>
               </header>

               {/* View Content */}
               <div className="flex-1 overflow-y-auto p-6 sm:p-10 custom-scrollbar relative z-10">
                  <AnimatePresence mode="wait">
                    {activeTab === 'dashboard' && <DashboardView profile={profile} expenses={expenses} />}
                    {activeTab === 'budget' && (
                      <BudgetView 
                        profile={profile}
                        monthlyBudgets={monthlyBudgets} 
                        isCreating={isCreatingBudget}
                        setIsCreating={setIsCreatingBudget}
                        duplicateBudget={duplicateBudget}
                        onboardingStep={onboardingStep}
                        setOnboardingStep={setOnboardingStep}
                        income={income}
                        setIncome={setIncome}
                        budgetRule={budgetRule}
                        setBudgetRule={setBudgetRule}
                        budgetLines={budgetLines}
                        applyRuleTemplate={applyRuleTemplate}
                        updateLine={updateLine}
                        removeLine={removeLine}
                        addCustomLine={addCustomLine}
                        remaining={remaining}
                        savingsGoal={savingsGoal}
                        setSavingsGoal={setSavingsGoal}
                        isLoading={isLoading}
                        createSpecificBudget={createSpecificBudget}
                      />
                    )}
                    {activeTab === 'expenses' && <ExpensesView profile={profile} expenses={expenses} onAdd={() => setIsAddingExpense(true)} />}
                    {activeTab === 'savings' && <EmptyShell title="Épargne" icon={<PiggyBank size={48} />} />}
                  </AnimatePresence>
               </div>

               {/* Bottom Navigation (Mobile) */}
               <nav className="lg:hidden h-20 bg-slate-900 border-t border-white/5 flex items-center justify-around px-2 shrink-0 pb-safe relative z-40">
                  <MobileNavButton active={activeTab === 'dashboard'} onClick={() => setActiveTab('dashboard')} icon={<LayoutDashboard size={24} />} label="Dash" />
                  <MobileNavButton active={activeTab === 'budget'} onClick={() => setActiveTab('budget')} icon={<PieChart size={24} />} label="Budget" />
                  <div className="relative -top-6">
                    <button 
                      onClick={() => setIsAddingExpense(true)}
                      className="w-14 h-14 bg-emerald-500 text-slate-950 rounded-2xl shadow-xl shadow-emerald-500/40 flex items-center justify-center active:scale-90 transition-transform"
                    >
                      <Plus size={28} />
                    </button>
                  </div>
                  <MobileNavButton active={activeTab === 'expenses'} onClick={() => setActiveTab('expenses')} icon={<Receipt size={24} />} label="Dépenses" />
                  <MobileNavButton active={activeTab === 'savings'} onClick={() => setActiveTab('savings')} icon={<PiggyBank size={24} />} label="Épargne" />
               </nav>

               {/* Desktop FAB */}
               <button 
                  onClick={() => setIsAddingExpense(true)}
                  className="fixed bottom-10 right-10 w-16 h-16 bg-emerald-500 text-slate-950 rounded-2xl shadow-2xl shadow-emerald-500/20 hidden lg:flex items-center justify-center hover:scale-110 active:scale-95 transition-all z-40 group"
               >
                  <Plus size={32} />
                  <span className="absolute right-full mr-4 bg-slate-900 text-white text-xs font-bold px-4 py-2 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">Ajouter une dépense</span>
               </button>
            </main>

            {/* Mobile Sidebar Overlay */}
            <AnimatePresence>
              {isSidebarOpen && (
                <>
                  <motion.div 
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    onClick={() => setIsSidebarOpen(false)}
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
                  />
                  <motion.aside
                    initial={{ x: '-100%' }}
                    animate={{ x: 0 }}
                    exit={{ x: '-100%' }}
                    transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                    className="fixed inset-y-0 left-0 w-80 bg-[#0D1426] z-[101] p-8 flex flex-col shadow-2xl"
                  >
                    <div className="flex justify-between items-center mb-10">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center text-slate-950 font-bold">P</div>
                        <span className="text-xl font-bold text-white">PesaFlow</span>
                      </div>
                      <button onClick={() => setIsSidebarOpen(false)} className="p-2 text-slate-500">
                        <X size={24} />
                      </button>
                    </div>
                    
                    <div className="space-y-4">
                       <p className="text-[10px] text-slate-600 font-bold uppercase tracking-widest ml-4">Menu Principal</p>
                       <NavButton active={activeTab === 'dashboard'} onClick={() => { setActiveTab('dashboard'); setIsSidebarOpen(false); }} icon={<LayoutDashboard size={20} />} label="Dashboard" />
                       <NavButton active={activeTab === 'budget'} onClick={() => { setActiveTab('budget'); setIsSidebarOpen(false); }} icon={<PieChart size={20} />} label="Budget" />
                       <NavButton active={activeTab === 'expenses'} onClick={() => { setActiveTab('expenses'); setIsSidebarOpen(false); }} icon={<Receipt size={20} />} label="Dépenses" />
                       <NavButton active={activeTab === 'savings'} onClick={() => { setActiveTab('savings'); setIsSidebarOpen(false); }} icon={<PiggyBank size={20} />} label="Épargne" />
                    </div>

                    <div className="mt-auto">
                      <button 
                        onClick={handleLogout}
                        className="w-full flex items-center gap-3 p-4 text-rose-400 bg-rose-400/5 rounded-2xl font-bold"
                      >
                        <LogOut size={20} /> Déconnexion
                      </button>
                    </div>
                  </motion.aside>
                </>
              )}
            </AnimatePresence>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isAddingExpense && profile && (
          <AddExpenseModal profile={profile} onClose={() => setIsAddingExpense(false)} onAdd={addExpense} isLoading={isLoading} />
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(16, 185, 129, 0.2);
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(16, 185, 129, 0.4);
        }
        input[type="number"]::-webkit-inner-spin-button, 
        input[type="number"]::-webkit-outer-spin-button { 
          -webkit-appearance: none; 
          margin: 0; 
        }
      `}</style>
    </div>
  );
}

function NavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "w-full flex items-center gap-4 p-4 rounded-2xl transition-all font-bold text-sm",
        active ? "bg-emerald-500 text-slate-950 shadow-lg shadow-emerald-500/20" : "text-slate-500 hover:text-white hover:bg-white/5"
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function MobileNavButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex flex-col items-center gap-1 p-2 rounded-xl transition-all min-w-[64px]",
        active ? "text-emerald-500" : "text-slate-600"
      )}
    >
      {icon}
      <span className="text-[9px] font-bold uppercase tracking-tighter">{label}</span>
    </button>
  );
}

function DashboardView({ profile, expenses }: { profile: UserProfile; expenses: Expense[] }) {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  
  const thisMonthExpenses = expenses.filter(e => {
    const d = e.date.toDate();
    return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
  });

  const totalExpenses = thisMonthExpenses.reduce((sum, e) => sum + e.amount, 0);
  const balance = profile.monthlyIncome - totalExpenses;
  const expenseRatio = (totalExpenses / profile.monthlyIncome) * 100;
  
  const essentialBudget = profile.budgetLines
    .filter(l => l.type === 'need')
    .reduce((sum, l) => sum + l.amount, 0);
  
  const possibleSavings = balance - essentialBudget;

  const typeSummaries = {
    need: thisMonthExpenses.filter(e => e.categoryType === 'need').reduce((sum, e) => sum + e.amount, 0),
    want: thisMonthExpenses.filter(e => e.categoryType === 'want').reduce((sum, e) => sum + e.amount, 0),
    saving: thisMonthExpenses.filter(e => e.categoryType === 'saving').reduce((sum, e) => sum + e.amount, 0),
  };

  const chartData = [
    { name: 'S-3', prev: 45000, curr: 42000 },
    { name: 'S-2', prev: 52000, curr: 48000 },
    { name: 'S-1', prev: 38000, curr: 51000 },
    { name: 'S0', prev: 41000, curr: Math.min(totalExpenses, 60000) },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      {/* Alerts */}
      <div className="space-y-3">
        {expenseRatio > 100 && (
          <AlertBox icon={<AlertCircle className="text-rose-400" />} title="Alerte critique" text="Vous avez dépassé votre revenu mensuel ! Réduisez immédiatement vos dépenses non-essentielles." theme="rose" />
        )}
        {expenseRatio > 70 && expenseRatio <= 100 && (
          <AlertBox icon={<Settings2 className="text-amber-400" />} title="Attention" text="Vous avez utilisé plus de 70% de votre budget. Soyez vigilant sur les prochains jours." theme="amber" />
        )}
        {possibleSavings < profile.monthlyIncome * 0.1 && (
          <AlertBox icon={<TrendingDown className="text-indigo-400" />} title="Conseil d'épargne" text="Votre épargne possible est faible ce mois-ci. Essayez de réduire les dépenses 'Envies'." theme="indigo" />
        )}
      </div>

      <div className="grid xl:grid-cols-3 gap-8">
        {/* Main Card */}
        <div className="xl:col-span-2 bg-gradient-to-br from-emerald-500 to-emerald-700 p-8 sm:p-10 rounded-[3rem] shadow-2xl shadow-emerald-500/20 relative overflow-hidden group">
          <div className="absolute top-0 right-0 p-40 bg-white/20 blur-[120px] rounded-full -translate-x-1/2 -translate-y-1/2"></div>
          <div className="relative z-10 flex flex-col sm:flex-row justify-between items-start gap-8">
             <div className="space-y-2">
               <div className="flex items-center gap-2 text-emerald-100/80 font-bold uppercase tracking-widest text-[11px]">
                 <Wallet size={14} /> Solde Mobile actuel
               </div>
               <h1 className="text-5xl sm:text-6xl font-mono font-extrabold text-white tracking-tighter">
                 {balance.toLocaleString()} <span className="text-2xl sm:text-3xl opacity-80">{profile.currency}</span>
               </h1>
               <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/10 rounded-full text-white text-[10px] font-bold uppercase tracking-widest mt-4">
                 <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span> {expenseRatio.toFixed(1)}% Utilisé
               </div>
             </div>
             <div className="bg-white/10 backdrop-blur-md rounded-[2.5rem] p-6 border border-white/10 w-full sm:w-64">
                <div className="space-y-4">
                   <div className="flex justify-between items-center">
                     <span className="text-[10px] text-emerald-100/60 font-bold uppercase tracking-widest">Épargne possible</span>
                     <TrendingUp size={16} className="text-emerald-300" />
                   </div>
                   <p className="text-2xl font-mono font-bold text-white tracking-tight">{possibleSavings.toLocaleString()} <small className="text-xs opacity-60">FCFA</small></p>
                   <div className="w-full bg-black/20 h-1.5 rounded-full overflow-hidden">
                     <div className="h-full bg-white/40" style={{ width: `${Math.min(100, (possibleSavings/profile.monthlyIncome)*100)}%` }}></div>
                   </div>
                </div>
             </div>
          </div>

          <div className="mt-12 w-full bg-black/10 rounded-full h-3 overflow-hidden border border-white/5">
            <motion.div 
              initial={{ width: 0 }}
              animate={{ width: `${Math.min(100, expenseRatio)}%` }}
              className={cn(
                "h-full transition-all duration-1000",
                expenseRatio > 100 ? "bg-rose-400" : expenseRatio > 70 ? "bg-amber-400" : "bg-white"
              )}
            ></motion.div>
          </div>
          <div className="flex justify-between mt-3 px-1 text-[10px] text-emerald-100/60 font-bold uppercase tracking-widest">
            <span>Dépensé: {totalExpenses.toLocaleString()}</span>
            <span>Budget: {profile.monthlyIncome.toLocaleString()}</span>
          </div>
        </div>

        {/* Mini Summaries */}
        <div className="space-y-4">
           <SummaryCard title="Besoins" amount={typeSummaries.need} total={profile.budgetLines.filter(l => l.type === 'need').reduce((sum, l) => sum + l.amount, 0)} icon={<ShieldCheck className="text-blue-400" />} color="blue" currency={profile.currency} />
           <SummaryCard title="Envies" amount={typeSummaries.want} total={profile.budgetLines.filter(l => l.type === 'want').reduce((sum, l) => sum + l.amount, 0)} icon={<Settings2 className="text-amber-400" />} color="amber" currency={profile.currency} />
           <SummaryCard title="Épargne" amount={typeSummaries.saving} total={profile.budgetLines.filter(l => l.type === 'saving').reduce((sum, l) => sum + l.amount, 0)} icon={<PiggyBank className="text-indigo-400" />} color="indigo" currency={profile.currency} />
        </div>
      </div>

      <div className="grid xl:grid-cols-2 gap-8">
         {/* History Chart */}
         <div className="bg-slate-900/60 backdrop-blur-3xl border border-white/5 p-8 rounded-[3rem] space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-white tracking-tight">Performance Mensuelle</h3>
              <div className="flex items-center gap-4 text-[10px] font-bold uppercase tracking-widest">
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-500"></span> Actuel</div>
                <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-slate-700"></span> Précédent</div>
              </div>
            </div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorCurr" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="name" stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} />
                  <YAxis stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} tickFormatter={(val) => `${val/1000}k`} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  />
                  <Area type="monotone" dataKey="curr" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#colorCurr)" />
                  <Area type="monotone" dataKey="prev" stroke="#334155" strokeWidth={2} strokeDasharray="5 5" fill="transparent" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
         </div>

         {/* Recent Expenses */}
         <div className="bg-slate-900/60 backdrop-blur-3xl border border-white/5 p-8 rounded-[3rem] space-y-6 flex flex-col">
            <div className="flex justify-between items-center">
              <h3 className="text-xl font-bold text-white tracking-tight">Dernières Dépenses</h3>
              <button className="text-sm font-bold text-emerald-400 hover:text-emerald-300 transition-colors">Voir tout</button>
            </div>
            
            <div className="flex-1 space-y-3 overflow-hidden">
              {thisMonthExpenses.length > 0 ? (
                thisMonthExpenses.slice(0, 5).map(expense => (
                  <div key={expense.id} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl group hover:bg-white/10 transition-all border border-transparent hover:border-white/5">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-xl flex items-center justify-center",
                        expense.categoryType === 'need' ? "bg-blue-400/10 text-blue-400" : 
                        expense.categoryType === 'want' ? "bg-amber-400/10 text-amber-400" : 
                        "bg-indigo-400/10 text-indigo-400"
                      )}>
                        <Receipt size={22} />
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">{expense.category}</p>
                        <p className="text-[10px] text-slate-500 uppercase font-bold tracking-widest">{expense.description || 'Sans description'}</p>
                      </div>
                    </div>
                    <div className="text-right">
                       <p className="text-sm font-mono font-bold text-white">-{expense.amount.toLocaleString()} <small className="text-[10px] opacity-60">{profile.currency}</small></p>
                       <p className="text-[9px] text-slate-600 font-bold uppercase tracking-widest">{expense.date.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</p>
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-10 space-y-4">
                  <div className="w-16 h-16 bg-white/5 border border-white/5 rounded-3xl flex items-center justify-center text-slate-700">
                    <History size={32} />
                  </div>
                  <div>
                    <p className="text-slate-400 font-bold">Aucune dépense ce mois-ci</p>
                    <p className="text-sm text-slate-600">Commencez à saisir vos achats pour voir les statistiques.</p>
                  </div>
                </div>
              )}
            </div>
         </div>
      </div>
    </motion.div>
  );
}

function SummaryCard({ title, amount, total, icon, color, currency }: { title: string; amount: number; total: number; icon: React.ReactNode; color: 'blue' | 'amber' | 'indigo'; currency: string }) {
  const percent = total > 0 ? (amount / total) * 100 : 0;
  
  const colors = {
    blue: "bg-blue-500",
    amber: "bg-amber-500",
    indigo: "bg-indigo-500"
  };

  return (
    <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/5 p-6 rounded-[2.5rem] flex items-center gap-6">
       <div className="w-14 h-14 bg-white/5 rounded-[1.5rem] flex items-center justify-center shrink-0">
          {icon}
       </div>
       <div className="flex-1 space-y-2">
          <div className="flex justify-between items-end">
            <div>
               <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{title}</p>
               <p className="text-lg font-mono font-bold text-white">{amount.toLocaleString()} <small className="text-[10px] opacity-60">{currency}</small></p>
            </div>
            <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full bg-white/5", percent > 100 ? "text-rose-400" : "text-white/60")}>
              {percent.toFixed(0)}%
            </span>
          </div>
          <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
            <motion.div 
               initial={{ width: 0 }}
               animate={{ width: `${Math.min(100, percent)}%` }}
               className={cn("h-full", colors[color])}
            />
          </div>
       </div>
    </div>
  );
}

function AlertBox({ icon, title, text, theme }: { icon: React.ReactNode; title: string; text: string; theme: 'rose' | 'amber' | 'indigo' }) {
  const themes = {
    rose: "bg-rose-500/10 border-rose-500/20 text-rose-200",
    amber: "bg-amber-500/10 border-amber-500/20 text-amber-200",
    indigo: "bg-indigo-500/10 border-indigo-500/20 text-indigo-200"
  };

  return (
    <motion.div 
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className={cn("p-4 rounded-2xl border flex gap-4 items-start", themes[theme])}
    >
      <div className="p-2 bg-white/5 rounded-xl shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold mb-1">{title}</p>
        <p className="text-xs opacity-70 leading-relaxed">{text}</p>
      </div>
    </motion.div>
  );
}

function BudgetView(props: {
  profile: UserProfile;
  monthlyBudgets: MonthlyBudget[];
  isCreating: boolean;
  setIsCreating: (v: boolean) => void;
  duplicateBudget: (b: MonthlyBudget) => void;
  onboardingStep: OnboardingStep;
  setOnboardingStep: (s: OnboardingStep) => void;
  income: number;
  setIncome: (v: number) => void;
  budgetRule: BudgetRule;
  setBudgetRule: (r: BudgetRule) => void;
  budgetLines: BudgetLine[];
  applyRuleTemplate: () => void;
  updateLine: (id: string, u: Partial<BudgetLine>) => void;
  removeLine: (id: string) => void;
  addCustomLine: () => void;
  remaining: number;
  savingsGoal: number;
  setSavingsGoal: (v: number) => void;
  isLoading: boolean;
  createSpecificBudget: (m: number, y: number) => void;
}) {
  const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  if (props.isCreating) {
    return (
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -20 }}
        className="max-w-2xl mx-auto"
      >
        <div className="flex items-center gap-4 mb-8">
           <button onClick={() => props.setIsCreating(false)} className="p-3 bg-white/5 text-slate-400 hover:text-white rounded-2xl transition-colors">
             <ChevronLeft size={24} />
           </button>
           <h2 className="text-3xl font-extrabold text-white">Nouveau Budget</h2>
        </div>

        <div className="bg-slate-900/60 backdrop-blur-3xl p-8 sm:p-12 rounded-[3.5rem] border border-white/10 shadow-2xl space-y-8">
           <AnimatePresence mode="wait">
              {props.onboardingStep === 1 && (
                <motion.div key="step1" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-8">
                   <div className="space-y-2">
                     <p className="text-emerald-400 font-bold uppercase tracking-widest text-[10px]">Étape 1 sur 3</p>
                     <h3 className="text-2xl font-bold text-white">Quel est votre revenu pour cette période ?</h3>
                   </div>
                   <div className="relative group">
                     <span className="absolute left-6 top-1/2 -translate-y-1/2 text-slate-500 font-bold text-xl group-focus-within:text-emerald-400 transition-colors">{props.profile.currency}</span>
                     <input 
                       type="number"
                       value={props.income || ''}
                       onChange={(e) => props.setIncome(Number(e.target.value))}
                       placeholder="Ex: 300000"
                       className="w-full bg-white/5 border-2 border-white/10 rounded-3xl py-6 pl-24 pr-8 text-2xl font-mono font-bold text-white focus:outline-none focus:border-emerald-500 transition-all"
                     />
                   </div>
                   <button onClick={() => props.setOnboardingStep(2)} className="w-full bg-emerald-500 text-slate-950 font-bold py-5 rounded-2xl hover:bg-emerald-400 transition-all text-lg shadow-lg shadow-emerald-500/20">
                     Continuer
                   </button>
                </motion.div>
              )}

              {props.onboardingStep === 2 && (
                <motion.div key="step2" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-8">
                   <div className="space-y-2">
                     <p className="text-emerald-400 font-bold uppercase tracking-widest text-[10px]">Étape 2 sur 3</p>
                     <h3 className="text-2xl font-bold text-white">Choisir une structure</h3>
                   </div>
                   <div className="grid sm:grid-cols-2 gap-4">
                      <button onClick={() => props.setBudgetRule('50/30/20')} className={cn("p-6 rounded-3xl border-2 text-left transition-all", props.budgetRule === '50/30/20' ? 'bg-emerald-500/10 border-emerald-500 shadow-xl' : 'bg-white/5 border-white/10 hover:border-white/20')}>
                        <PieChart className="mb-4 text-emerald-400" size={32} />
                        <h4 className="text-lg font-bold text-white mb-2">50/30/20</h4>
                        <p className="text-xs text-slate-400">Modèle classique basé sur des pourcentages fixes.</p>
                      </button>
                      <button onClick={() => props.setBudgetRule('custom')} className={cn("p-6 rounded-3xl border-2 text-left transition-all", props.budgetRule === 'custom' ? 'bg-emerald-500/10 border-emerald-500 shadow-xl' : 'bg-white/5 border-white/10 hover:border-white/20')}>
                        <Settings2 className="mb-4 text-emerald-400" size={32} />
                        <h4 className="text-lg font-bold text-white mb-2">Personnalisé</h4>
                        <p className="text-xs text-slate-400">Définissez vos propres catégories de A à Z.</p>
                      </button>
                   </div>
                   <div className="flex gap-4">
                     <button onClick={() => props.setOnboardingStep(1)} className="w-1/3 bg-white/5 text-white font-bold py-4 rounded-2xl border border-white/10 hover:bg-white/10 transition-all">Retour</button>
                     <button onClick={props.applyRuleTemplate} className="flex-1 bg-emerald-500 text-slate-950 font-bold py-4 rounded-2xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20">Suivant</button>
                   </div>
                </motion.div>
              )}

              {props.onboardingStep === 3 && (
                <motion.div key="step3" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} className="space-y-6">
                   <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
                      <div>
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Disponible</p>
                        <p className={cn("text-xl font-mono font-bold", props.remaining < 0 ? 'text-rose-400' : 'text-emerald-400')}>{props.remaining.toLocaleString()} {props.profile.currency}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest mb-1">Total</p>
                        <p className="text-xl font-mono font-bold text-white">{props.income.toLocaleString()} {props.profile.currency}</p>
                      </div>
                   </div>

                   <div className="space-y-3 max-h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                      {props.budgetLines.map((line) => (
                         <div key={line.id} className="bg-white/5 p-3 rounded-2xl border border-white/5 flex gap-3 items-center group">
                            <select 
                              value={line.type}
                              onChange={(e) => props.updateLine(line.id, { type: e.target.value as BudgetType })}
                              className="bg-slate-800 text-[9px] text-slate-300 font-bold rounded-lg px-2 py-1 focus:ring-1 focus:ring-emerald-500 outline-none uppercase"
                            >
                              <option value="need">Besoin</option>
                              <option value="want">Envie</option>
                              <option value="saving">Épargne</option>
                            </select>
                            <input 
                              type="text"
                              value={line.name}
                              onChange={(e) => props.updateLine(line.id, { name: e.target.value })}
                              placeholder="Libellé"
                              className="flex-1 bg-transparent border-none text-sm text-white focus:ring-0 placeholder:text-slate-700"
                            />
                            <input 
                              type="number"
                              value={line.amount || ''}
                              onChange={(e) => props.updateLine(line.id, { amount: Number(e.target.value) })}
                              className="w-24 bg-white/5 rounded-xl py-1.5 px-3 text-right font-mono text-emerald-400 border border-white/5 focus:border-emerald-500 outline-none text-xs"
                              placeholder="0"
                            />
                            <button onClick={() => props.removeLine(line.id)} className="text-slate-600 hover:text-rose-400 transition-colors p-1">
                              <Trash2 size={16} />
                            </button>
                         </div>
                      ))}
                      <button onClick={props.addCustomLine} className="w-full border border-dashed border-white/10 rounded-2xl py-3 text-slate-500 hover:bg-white/5 hover:text-white transition-all text-[11px] font-bold uppercase tracking-widest">
                        + Ajouter une ligne
                      </button>
                   </div>

                   <div className="flex gap-4 pt-4">
                     <button onClick={() => props.setOnboardingStep(2)} className="w-1/3 bg-white/5 text-white font-bold py-4 rounded-2xl border border-white/10 hover:bg-white/10 transition-all">Retour</button>
                     <button 
                       disabled={props.isLoading || props.budgetLines.some(l => !l.name)}
                       onClick={() => props.createSpecificBudget(new Date().getMonth(), new Date().getFullYear())}
                       className="flex-1 bg-emerald-500 text-slate-950 font-bold py-4 rounded-2xl hover:bg-emerald-400 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50"
                     >
                       Enregistrer le budget
                     </button>
                   </div>
                </motion.div>
              )}
           </AnimatePresence>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
         <div>
           <h2 className="text-3xl font-extrabold text-white tracking-tight">Budgets Mensuels</h2>
           <p className="text-slate-500 font-medium">Historique et planification de vos finances.</p>
         </div>
         <button 
            onClick={() => props.setIsCreating(true)}
            className="px-8 py-4 bg-emerald-500 text-slate-950 font-bold rounded-2xl hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 flex items-center gap-2"
          >
           <Plus size={20} /> Créer un budget
         </button>
      </div>

      <div className="grid xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-6">
           {props.monthlyBudgets.length > 0 ? (
             <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/5 rounded-[2.5rem] overflow-hidden overflow-x-auto">
                <table className="w-full text-left border-collapse min-w-[600px]">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Période</th>
                      <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Type</th>
                      <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Revenu</th>
                      <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-center">Status</th>
                      <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {props.monthlyBudgets.map((budget) => (
                      <tr key={budget.id} className="group hover:bg-white/5 transition-colors">
                        <td className="p-6">
                          <p className="text-sm font-bold text-white">{months[budget.month]} {budget.year}</p>
                          <p className="text-[10px] text-slate-600 font-medium uppercase tracking-widest">Créé le {new Date(budget.createdAt).toLocaleDateString()}</p>
                        </td>
                        <td className="p-6">
                          <span className="text-[10px] font-bold px-2 py-1 rounded-lg bg-white/5 text-slate-400 border border-white/5 uppercase">
                            {budget.rule === '50/30/20' ? 'Standard 50/30/20' : 'Personnalisé'}
                          </span>
                        </td>
                        <td className="p-6">
                           <p className="text-sm font-mono font-bold text-white">{budget.income.toLocaleString()} {props.profile.currency}</p>
                        </td>
                        <td className="p-6 text-center">
                          <span className={cn(
                            "text-[9px] font-extrabold px-3 py-1 rounded-full uppercase tracking-widest",
                            budget.status === 'active' ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" : "bg-slate-500/10 text-slate-500 border border-slate-500/20"
                          )}>
                             {budget.status === 'active' ? 'Actif' : 'Archivé'}
                          </span>
                        </td>
                        <td className="p-6 text-right">
                          <button 
                            onClick={() => props.duplicateBudget(budget)}
                            className="p-2 text-slate-500 hover:text-emerald-400 transition-colors"
                            title="Dupliquer pour le mois suivant"
                          >
                             <History size={18} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>
           ) : (
             <div className="bg-slate-900/20 border-2 border-dashed border-white/5 rounded-[3rem] p-16 text-center space-y-6">
                <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center text-slate-800 mx-auto">
                  <PieChart size={32} />
                </div>
                <div className="space-y-2">
                   <p className="text-lg font-bold text-white">Aucun budget enregistré</p>
                   <p className="text-sm text-slate-600 max-w-xs mx-auto leading-relaxed">Commencez par créer votre premier budget mensuel pour suivre vos finances.</p>
                </div>
             </div>
           )}
        </div>

        <div className="space-y-6">
           <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/5 p-8 rounded-[2.5rem] space-y-6">
              <h4 className="text-lg font-bold text-white tracking-tight flex items-center gap-3">
                 <ShieldCheck className="text-emerald-400" size={20} /> Conseils de gestion
              </h4>
              <div className="space-y-4">
                 <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-300">Duplication intelligente</p>
                    <p className="text-xs text-slate-500 leading-relaxed">Utilisez l'icône de duplication pour copier rapidement la structure d'un mois fructueux sur le mois suivant.</p>
                 </div>
                 <div className="space-y-2">
                    <p className="text-xs font-bold text-slate-300">Règle des 50/30/20</p>
                    <p className="text-xs text-slate-500 leading-relaxed">C'est le modèle recommandé pour un équilibre parfait entre vie quotidienne et futur financier.</p>
                 </div>
              </div>
           </div>
           <div className="bg-gradient-to-tr from-indigo-600 to-indigo-800 p-8 rounded-[2.5rem] shadow-xl shadow-indigo-600/10 transition-transform hover:scale-[1.02] cursor-pointer">
              <div className="flex items-center gap-3 text-indigo-100/60 font-bold uppercase tracking-widest text-[10px] mb-4">
                <PiggyBank size={14} /> Total Épargné (Cumul)
              </div>
              <p className="text-3xl font-mono font-bold text-white">0 {props.profile.currency}</p>
           </div>
        </div>
      </div>
    </motion.div>
  );
}

function ExpensesView({ profile, expenses, onAdd }: { profile: UserProfile; expenses: Expense[]; onAdd: () => void }) {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [filterMonth, setFilterMonth] = useState<number>(new Date().getMonth());

  const months = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre"];

  const filtered = expenses.filter(e => {
    const d = e.date.toDate();
    const catMatch = filterCategory === 'all' || e.category === filterCategory;
    const monthMatch = d.getMonth() === filterMonth;
    return catMatch && monthMatch;
  });

  const uniqueCategories = Array.from(new Set(expenses.map(e => e.category)));

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="space-y-8"
    >
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
         <div>
           <h2 className="text-3xl font-extrabold text-white tracking-tight">Journal des Dépenses</h2>
           <p className="text-slate-500 font-medium">Suivez chaque centime en temps réel.</p>
         </div>
         <button 
           onClick={onAdd}
           className="px-8 py-4 bg-emerald-500 text-slate-950 font-bold rounded-2xl hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 flex items-center gap-2"
         >
           <Plus size={20} /> Ajouter
         </button>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/5 p-6 rounded-[2.5rem] flex flex-wrap gap-4 items-center">
         <div className="flex items-center gap-3">
            <Filter size={18} className="text-slate-500" />
            <select 
              value={filterMonth}
              onChange={(e) => setFilterMonth(Number(e.target.value))}
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {months.map((m, i) => <option key={i} value={i}>{m}</option>)}
            </select>
         </div>
         <select 
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-xs font-bold text-white outline-none focus:ring-1 focus:ring-emerald-500"
         >
            <option value="all">Toutes les catégories</option>
            {uniqueCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
         </select>
      </div>

      <div className="bg-slate-900/40 backdrop-blur-3xl border border-white/5 rounded-[2.5rem] overflow-hidden overflow-x-auto">
         <table className="w-full text-left border-collapse min-w-[700px]">
            <thead>
               <tr className="border-b border-white/5">
                  <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Date</th>
                  <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Libellé</th>
                  <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Catégorie</th>
                  <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest">Moyen</th>
                  <th className="p-6 text-[10px] text-slate-500 font-bold uppercase tracking-widest text-right">Montant</th>
               </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
               {filtered.length > 0 ? filtered.map(expense => (
                  <tr key={expense.id} className="group hover:bg-white/5 transition-colors">
                     <td className="p-6">
                        <p className="text-sm font-bold text-white">{expense.date.toDate().toLocaleDateString()}</p>
                     </td>
                     <td className="p-6">
                        <p className="text-sm text-slate-300 font-medium">{expense.description}</p>
                     </td>
                     <td className="p-6">
                        <span className={cn(
                          "text-[9px] font-bold px-2 py-0.5 rounded-full uppercase",
                          expense.categoryType === 'need' ? "bg-blue-500/10 text-blue-400" :
                          expense.categoryType === 'want' ? "bg-amber-500/10 text-amber-400" :
                          "bg-indigo-500/10 text-indigo-400"
                        )}>
                           {expense.category}
                        </span>
                     </td>
                     <td className="p-6">
                        <p className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">{expense.paymentMethod}</p>
                     </td>
                     <td className="p-6 text-right">
                        <p className="text-sm font-mono font-bold text-white">-{expense.amount.toLocaleString()} {profile.currency}</p>
                     </td>
                  </tr>
               )) : (
                  <tr>
                     <td colSpan={5} className="p-20 text-center text-slate-600 font-bold uppercase tracking-widest text-xs">Aucune dépense trouvée avec ces filtres</td>
                  </tr>
               )}
            </tbody>
         </table>
      </div>
    </motion.div>
  );
}

function AddExpenseModal({ profile, onClose, onAdd, isLoading }: { profile: UserProfile; onClose: () => void; onAdd: (d: any) => void; isLoading: boolean }) {
  const [data, setData] = useState({
    amount: 0,
    categoryId: profile.budgetLines[0]?.id || '',
    description: '',
    date: new Date(),
    paymentMethod: 'Cash' as PaymentMethod
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative w-full max-w-md bg-slate-900 border border-white/10 rounded-[2.5rem] p-8 shadow-2xl overflow-hidden"
      >
        <div className="absolute top-0 right-0 p-32 bg-emerald-500/10 blur-[80px] rounded-full -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
        
        <div className="flex justify-between items-center mb-8 relative z-10">
           <h3 className="text-2xl font-bold text-white tracking-tight">Ajouter une dépense</h3>
           <button onClick={onClose} className="text-slate-500 hover:text-white transition-colors"><X size={24} /></button>
        </div>

        <div className="space-y-6 relative z-10">
           <div className="space-y-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Montant</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">{profile.currency}</span>
                <input 
                  autoFocus
                  type="number"
                  value={data.amount || ''}
                  onChange={(e) => setData({ ...data, amount: Number(e.target.value) })}
                  className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 pl-16 pr-4 text-xl font-mono font-bold text-white focus:outline-none focus:border-emerald-500 transition-all"
                  placeholder="0"
                />
              </div>
           </div>

           <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                 <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Catégorie</label>
                 <select 
                   value={data.categoryId}
                   onChange={(e) => setData({ ...data, categoryId: e.target.value })}
                   className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-4 text-xs font-bold text-white outline-none focus:border-emerald-500 transition-all"
                 >
                    {profile.budgetLines.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                 </select>
              </div>
              <div className="space-y-2">
                 <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Paiement</label>
                 <select 
                   value={data.paymentMethod}
                   onChange={(e) => setData({ ...data, paymentMethod: e.target.value as PaymentMethod })}
                   className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-4 text-xs font-bold text-white outline-none focus:border-emerald-500 transition-all"
                 >
                    <option value="Cash">Cash</option>
                    <option value="Mobile Money">Mobile Money</option>
                    <option value="Banque">Banque</option>
                 </select>
              </div>
           </div>

           <div className="space-y-2">
              <label className="text-[10px] text-slate-500 font-bold uppercase tracking-widest">Note/Libellé</label>
              <input 
                type="text"
                value={data.description}
                onChange={(e) => setData({ ...data, description: e.target.value })}
                placeholder="Ex: Courses mensuelles"
                className="w-full bg-white/5 border border-white/10 rounded-2xl py-4 px-6 text-sm font-medium text-white focus:outline-none focus:border-emerald-500 transition-all"
              />
           </div>

           <button 
             disabled={isLoading || !data.amount || !data.description}
             onClick={() => onAdd(data)}
             className="w-full bg-emerald-500 text-slate-950 font-bold py-4 rounded-2xl hover:bg-emerald-400 transition-all shadow-xl shadow-emerald-500/20 disabled:opacity-50 mt-4 h-14"
           >
             {isLoading ? 'Enregistrement...' : 'Ajouter la dépense'}
           </button>
        </div>
      </motion.div>
    </div>
  );
}

function EmptyShell({ title, icon }: { title: string; icon: React.ReactNode }) {
  return (
    <motion.div 
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="h-[60vh] flex flex-col items-center justify-center text-center p-10 bg-slate-900/20 border border-white/10 border-dashed rounded-[4rem] space-y-6"
    >
      <div className="p-8 bg-white/5 rounded-full text-slate-800">
        {icon}
      </div>
      <div className="space-y-3">
        <h2 className="text-3xl font-extrabold text-white tracking-tight">{title}</h2>
        <p className="text-slate-500 max-w-sm mx-auto leading-relaxed">
          Cette fonctionnalité est en cours de développement. Bientôt, vous pourrez gérer cette partie de vos finances.
        </p>
      </div>
    </motion.div>
  );
}
