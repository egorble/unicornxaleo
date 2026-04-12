import React, { useState, useEffect } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { blockchainCache } from '../lib/cache';
import { PreloadKeys } from '../lib/preload';


interface FeedEvent {
    id: number;
    startup: string;
    eventType: string;
    description: string;
    points: number;
    tweetId: string | null;
    date: string;
    createdAt: string;
    summary: string | null;
}

// Map Twitter handles for building tweet URLs
const STARTUP_HANDLES: Record<string, string> = {
    'Openclaw': 'openclaw',
    'Lovable': 'lovable_dev',
    'Cursor': 'cursor_ai',
    'OpenAI': 'OpenAI',
    'Anthropic': 'AnthropicAI',
    'Browser Use': 'browser_use',
    'Dedalus Labs': 'dedaluslabs',
    'Autumn': 'autumnpricing',
    'Axiom': 'axiom_xyz',
    'Multifactor': 'MultifactorCOM',
    'Dome': 'getdomeapi',
    'GrazeMate': 'GrazeMate',
    'Tornyol Systems': 'tornyolsystems',
    'Pocket': 'heypocket',
    'Caretta': 'Caretta',
    'AxionOrbital Space': 'axionorbital',
    'Freeport Markets': 'freeportmrkts',
    'Ruvo': 'ruvopay',
    'Lightberry': 'lightberryai',
};

function getTweetUrl(event: FeedEvent): string | null {
    if (!event.tweetId) return null;
    const handle = STARTUP_HANDLES[event.startup];
    if (handle) {
        return `https://x.com/${handle}/status/${event.tweetId}`;
    }
    return `https://x.com/i/status/${event.tweetId}`;
}

// Truncate tweet text to a clean headline
function toHeadline(text: string, maxLen = 100): string {
    if (text.length <= maxLen) return text;
    const cut = text.substring(0, maxLen);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 40 ? cut.substring(0, lastSpace) : cut) + '...';
}

const LiveFeed: React.FC = () => {
    // Use preloaded feed data for instant render
    const preloaded = blockchainCache.get<FeedEvent[]>(PreloadKeys.liveFeed);
    const [events, setEvents] = useState<FeedEvent[]>(preloaded || []);
    const [loading, setLoading] = useState(!preloaded);

    const fetchFeed = async () => {
        try {
            const res = await fetch('/api/live-feed?limit=15');
            const data = await res.json();
            if (data.success && data.data.length > 0) {
                setEvents(data.data);
                blockchainCache.set(PreloadKeys.liveFeed, data.data);
            }
        } catch (err) {
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Fetch once on mount only if no preloaded data exists
        // Live feed changes only when the daily scorer runs — no need to poll
        if (!preloaded) {
            fetchFeed();
        } else {
            setLoading(false);
        }
    }, []);

    // Sorted newest-first by timestamp from backend
    const displayEvents = events.length > 0 ? events : [];

    // Duplicate for seamless infinite scroll
    const marqueeItems = [...displayEvents, ...displayEvents];

    if (!loading && displayEvents.length === 0) return null;

    return (
        <div className="w-full glass-panel rounded-xl py-3 px-4 mb-8 overflow-hidden">
            <div className="flex items-center gap-3">
                {/* Fixed label */}
                <div className="flex items-center shrink-0 pr-3 border-r border-orange-500/20">
                    <Activity className="w-4 h-4 text-yc-aleo mr-2" />
                    <span className="text-xs font-bold text-gray-500 dark:text-[#888888] uppercase tracking-widest whitespace-nowrap">Live</span>
                    {loading && <RefreshCw className="w-3 h-3 text-gray-400 animate-spin ml-2" />}
                </div>

                {/* Scrolling marquee */}
                <div className="overflow-hidden flex-1">
                    <div className="flex animate-marquee whitespace-nowrap">
                        {marqueeItems.map((event, idx) => {
                            const tweetUrl = getTweetUrl(event);
                            const headline = event.summary || toHeadline(event.description);

                            const content = (
                                <div className="inline-flex items-center mr-10 shrink-0">
                                    <span className="text-xs font-bold text-yc-aleo mr-1.5">{event.startup}</span>
                                    <span className="text-sm text-gray-700 dark:text-gray-300 mr-2">{headline}</span>
                                    <span className="text-xs font-mono font-bold text-green-500 shrink-0">
                                        +{event.points}
                                    </span>
                                </div>
                            );

                            return tweetUrl ? (
                                <a
                                    key={`${event.id}-${idx}`}
                                    href={tweetUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:opacity-70 transition-opacity cursor-pointer"
                                >
                                    {content}
                                </a>
                            ) : (
                                <div key={`${event.id}-${idx}`}>
                                    {content}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LiveFeed;
