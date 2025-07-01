// Content script for extracting page content and selected text

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'extractContent') {
        const content = extractPageContent();
        sendResponse({ content });
    } else if (request.action === 'getSelectedText') {
        const selectedText = getSelectedText();
        sendResponse({ selectedText });
    }
});

function getSelectedText() {
    const selection = window.getSelection();
    if (selection && selection.toString().trim()) {
        return selection.toString().trim();
    }
    return '';
}

function extractPageContent() {
    // First check computed styles on original elements
    const hiddenElements = new Set();
    document.querySelectorAll('*').forEach((el, index) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') {
            hiddenElements.add(index);
        }
    });
    
    // Clone document and remove script/style elements
    const clonedDoc = document.cloneNode(true);
    const scripts = clonedDoc.querySelectorAll('script, style, noscript');
    scripts.forEach(el => el.remove());
    
    // Remove hidden elements based on our earlier check
    const allElements = clonedDoc.querySelectorAll('*');
    allElements.forEach((el, index) => {
        if (hiddenElements.has(index)) {
            el.remove();
        }
    });
    
    // Try to find main content areas
    let mainContent = '';
    
    // Look for article tags first
    const articles = clonedDoc.querySelectorAll('article');
    if (articles.length > 0) {
        articles.forEach(article => {
            mainContent += article.innerText + '\n\n';
        });
    }
    
    // Look for main tag
    const main = clonedDoc.querySelector('main');
    if (main && !mainContent) {
        mainContent = main.innerText;
    }
    
    // Look for content divs
    if (!mainContent) {
        const contentSelectors = [
            '[role="main"]',
            '.content',
            '#content',
            '.main-content',
            '#main-content',
            '.post-content',
            '.entry-content',
            '.article-content'
        ];
        
        for (const selector of contentSelectors) {
            const element = clonedDoc.querySelector(selector);
            if (element) {
                mainContent = element.innerText;
                break;
            }
        }
    }
    
    // If still no content, get body text but try to exclude navigation, footer, etc.
    if (!mainContent) {
        const body = clonedDoc.body;
        if (body) {
            // Remove common non-content elements
            const removeSelectors = [
                'nav', 'header', 'footer', 
                '.nav', '.header', '.footer',
                '#nav', '#header', '#footer',
                '.sidebar', '#sidebar',
                '.menu', '#menu',
                '.advertisement', '.ads', '.ad'
            ];
            
            removeSelectors.forEach(selector => {
                const elements = body.querySelectorAll(selector);
                elements.forEach(el => el.remove());
            });
            
            mainContent = body.innerText;
        }
    }
    
    // Get page title
    const title = document.title || '';
    
    // Get meta description if available
    const metaDesc = document.querySelector('meta[name="description"]');
    const description = metaDesc ? metaDesc.getAttribute('content') : '';
    
    // Combine all content
    let fullContent = '';
    if (title) fullContent += `Title: ${title}\n\n`;
    if (description) fullContent += `Description: ${description}\n\n`;
    fullContent += mainContent;
    
    // Clean up the content
    fullContent = fullContent
        .replace(/\s+/g, ' ') // Replace multiple spaces with single space
        .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newline
        .trim();
    
    // Limit content length to avoid token limits
    const maxLength = 10000;
    if (fullContent.length > maxLength) {
        fullContent = fullContent.substring(0, maxLength) + '...';
    }
    
    return fullContent;
}