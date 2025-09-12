export const pixelColors = [
    "#e6ca40",
    "#01daab",
    "#73e767",
    "#e7bc59",
]

export const PixelRow = ({ size = 8 }: { size?: number }) => {
    return (
        <div className="flex justify-between items-end gap-2">
            {pixelColors.map((color, index) => (
                <div
                    key={index}
                    style={{
                        backgroundColor: color,
                        height: `${size}px`,
                        width: `${size}px`
                    }}
                    className="rounded-xs"
                />
            ))}
        </div>
    )
}

export const PixelBg = () => {
    return (
        <>
            <div className="absolute z-[2] top-[17%] left-[15%] w-3 h-3 rounded-xs bg-[#e7bc59]/80 pixel" />
            <div className="absolute z-[2] top-[33%] left-[6%] w-3 h-3 rounded-xs bg-[#01daab]/40 pixel" />
            <div className="absolute z-[2] top-[28%] left-[82%] w-2 h-2 rounded-xs bg-[#73e767]/60 pixel" />
            <div className="absolute z-[2] top-[84%] left-[92%] w-5 h-5 rounded-xs bg-[#e7bc59]/70 pixel" />
            <div className="absolute z-[2] top-[88%] left-[3%] w-4 h-4 rounded-xs bg-[#e6ca40]/60 pixel" />
            <div className="absolute z-[2] top-[79%] left-[16%] w-2 h-2 rounded-xs bg-[#01daab]/70 pixel" />
            <div className="absolute z-[2] top-[14%] left-[98%] w-3 h-3 rounded-xs bg-[#e6ca40]/50 pixel" />
            <div className="absolute z-[2] top-[91%] left-[85%] w-4 h-4 rounded-xs bg-[#73e767]/70 pixel" />
        </>
    )
}

export const CircleBg = () => {
    return (
        <>
            <svg
                className="absolute z-[1] top-1/2 left-1/2 w-[110%] h-[110%] mt-8 -translate-x-1/2 -translate-y-1/2 animate-spin-slow"
                viewBox="0 0 200 200"
                fill="none"
            >
                <circle
                    cx="100"
                    cy="100"
                    r="90"
                    stroke="#e7bc59"
                    strokeWidth="0.35"
                    strokeDasharray="0.3 3"
                    strokeLinecap="round"
                    opacity="0.4"
                />
            </svg>

            <svg
                className="absolute z-[1] top-1/2 left-1/2 w-[110%] h-[110%] mt-8 -translate-x-1/2 -translate-y-1/2 animate-spin-slow2"
                viewBox="0 0 200 200"
                fill="none"
            >
                <circle
                    cx="100"
                    cy="100"
                    r="112"
                    stroke="#01daab"
                    strokeWidth="0.75"
                    strokeDasharray="0.1 3"
                    strokeLinecap="round"
                    opacity="0.1"
                />
            </svg>

            <svg
                className="absolute z-[1] top-1/2 left-1/2 w-[110%] h-[110%] mt-8 -translate-x-1/2 -translate-y-1/2 animate-spin-slow3"
                viewBox="0 0 200 200"
                fill="none"
            >
                <circle
                    cx="100"
                    cy="100"
                    r="150"
                    stroke="#a1e8ea"
                    strokeWidth="0.3"
                    strokeDasharray="0.6 4"
                    strokeLinecap="round"
                    opacity="0.2"
                />
            </svg>
        </>
    )
}

export const PartyText = ({ text = ["Hello", "world"] }: { text?: string[] }) => {
    return (
        <div className="mb-10 text-left font-medium text-sm">
            {text.map((item, index) => {
                const colorIndex = index % pixelColors.length; // Cycle through colors
                return (
                    <span
                        key={index}
                        style={{ color: pixelColors[colorIndex] }}
                    >
                        {`${item} `}
                    </span>
                );
            })}
        </div>
    )
}