import React, { useState, useEffect, createContext } from 'react';
import { MODELS, Model } from '../api/models';
import * as API from './api';

export type Message = {
    role: string;
    content: string;
};

export type State = {
    messages: Message[];
    files: string[];
    history: string[];
    historyOffset: number;
    readOnlyHistory: string[];
    model: Model;
};

export type StateImpl = State & {
    text: string;

    setModel: (model: Model) => void;
    setText: (text: string) => void;
    setHistoryOffset: (offset: number) => void;
};

const initialState = {
    messages: [],
    files: [],
    history: [""],
    historyOffset: 0,
    readOnlyHistory: [],
    model: MODELS[0],
};

export const StateContext = createContext<StateImpl>({
    ...initialState,
    text: "",

    setModel: () => {},
    setText: () => {},
    setHistoryOffset: () => {},
});


// State provider

export const StateProvider = ({ children }: { children: React.ReactNode }) => {
    const [state, setState] = useState<State>(initialState);
    let text = state.history[state.historyOffset];
    let setModel = (model: Model) => API.setModel(model.id);
    let setText = (text: string) => setState(state => ({
        ...state,
        history: state.history.map((x, i) => i === state.historyOffset ? text : x)
    }));
    let setHistoryOffset = (historyOffset: number) => setState(state => ({
        ...state,
        historyOffset: Math.min(state.history.length - 1, Math.max(0, historyOffset))
    }));

    function handleReceiveState(event: any) {
        let {model, files, messages, history} = event.value;
        let historyReset = event.resetHistory ? {history: ["", ...history], historyOffset: 0} : {};
        setState(state => ({...state, model, files, messages, readOnlyHistory: history, ...historyReset}));
    }

    useEffect(() => API.requestState(), []);
    useEffect(() => {
        API.addEventListener("state", handleReceiveState);
        return () => API.removeEventListener("state", handleReceiveState);
    }, []);

    return (
        <StateContext.Provider value={{...state, text, setModel, setText, setHistoryOffset}}>
            {children}
        </StateContext.Provider>
    );
};
